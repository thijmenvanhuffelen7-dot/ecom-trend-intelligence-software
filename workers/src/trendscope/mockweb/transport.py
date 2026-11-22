"""httpx-transport die het nep-internet serveert. Wordt in mock-modus in de PoliteHttpClient gehangen."""

from __future__ import annotations

import json
import zlib
from collections.abc import Callable
from datetime import timedelta

import httpx

from trendscope.mockweb import pages
from trendscope.mockweb.world import catalog, current_day, day_timestamp, sites

SOCIAL_HOSTS = {"api.tiktok-data-partner.example", "cdn.tiktok-data-partner.example", "googleapis.com", "i.ytimg.com"}
TREND_HOSTS = {"api.dataforseo.com", "reddit.com", "oauth.reddit.com"}  # host zonder "www."
MARKETPLACE_HOSTS = {
    "api-sg.aliexpress.com",
    "ae-pic-a1.aliexpress-media.com",
    "api.amazon.co.uk",
    "creatorsapi.amazon",
    "m.media-amazon.com",
    "developers.cjdropshipping.com",
    "cf.cjdropshipping.com",
}


def _stable(domain: str, salt: str) -> int:
    return zlib.crc32(f"{domain}:{salt}".encode()) % 100


def has_products_json(domain: str) -> bool:
    """~8% van de winkels heeft /products.json uitgeschakeld → de crawler valt terug op de sitemap."""
    return _stable(domain, "pj") >= 8


def has_bestseller_collection(domain: str) -> bool:
    return _stable(domain, "bs") < 70


class MockWebTransport(httpx.BaseTransport):
    def __init__(self, day: int | Callable[[], int] | None = None) -> None:
        self._day = day
        self.requests: list[str] = []  # voor tests: welke URL's zijn opgevraagd

    @property
    def day(self) -> int:
        if callable(self._day):
            return self._day()
        return current_day() if self._day is None else self._day

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(str(request.url))
        host = request.url.host.removeprefix("www.")
        if host == "graph.facebook.com" and "business_discovery" in request.url.params.get("fields", ""):
            return self._instagram(request)
        if host in SOCIAL_HOSTS:
            return self._social(request, host)
        if host == "graph.facebook.com":
            return self._meta(request)
        if host == "facebook.com" and request.url.path.startswith("/ads/archive/render_ad"):
            from trendscope.mockweb.ads_world import meta_snapshot_html

            if not request.url.params.get("access_token"):
                return httpx.Response(401, text="Login required")
            html = meta_snapshot_html(request.url.params.get("id", ""), self.day)
            return httpx.Response(200, html=html) if html else httpx.Response(404, text="Not found")
        if host == "open.tiktokapis.com":
            return self._tiktok(request)
        if host in TREND_HOSTS:
            return self._trends(request, host)
        if host in MARKETPLACE_HOSTS:
            return self._marketplace(request, host)
        if host == "crt.sh":
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nAllow: /\n")
            return self._crtsh(request)
        site = sites().get(host)
        if site is None or self.day < site.launch_day:
            raise httpx.ConnectError(f"Name or service not known: {host}", request=request)
        path = request.url.path
        day = self.day
        if request.method == "POST" and path == "/contact":
            from trendscope.mockweb.email_world import needs_challenge

            if needs_challenge(host):
                return httpx.Response(
                    200, html='<html><body><div class="h-captcha" data-sitekey="x"></div></body></html>'
                )
            return httpx.Response(200, html="<html><body><p>Thanks for subscribing</p></body></html>")
        if path == "/robots.txt":
            body = (
                pages.SHOPIFY_ROBOTS.format(domain=host)
                if site.platform == "shopify"
                else "User-agent: *\nDisallow: /wp-admin/\n"
            )
            return httpx.Response(200, text=body)
        if path == "/":
            if site.platform == "shopify":
                return httpx.Response(
                    200,
                    html=pages.shopify_home(site, catalog(host, day)),
                    headers={
                        "x-shopid": str(zlib.crc32(host.encode())),
                        "powered-by": "Shopify",
                        "set-cookie": "_shopify_y=abc; path=/",
                    },
                )
            return httpx.Response(200, html=pages.other_platform_home(site))
        if site.platform != "shopify":
            return httpx.Response(404, text="Not found")

        products = catalog(host, day)
        params = request.url.params
        if path == "/products.json":
            if not has_products_json(host):
                return httpx.Response(404, json={"errors": "Not Found"})
            limit = min(250, int(params.get("limit", "30")))
            page = max(1, int(params.get("page", "1")))
            chunk = products[(page - 1) * limit : page * limit]
            return httpx.Response(200, json={"products": [pages.shopify_product_json(p, site) for p in chunk]})
        if path == "/collections.json":
            return httpx.Response(200, json=pages.collections_json(site, products, has_bestseller_collection(host)))
        if path == "/collections/best-sellers/products.json" and has_bestseller_collection(host):
            ranked = sorted((p for p in products if p["best_seller_rank"]), key=lambda p: p["best_seller_rank"])
            return httpx.Response(200, json={"products": [pages.shopify_product_json(p, site) for p in ranked]})
        if path == "/sitemap.xml":
            return httpx.Response(200, text=pages.sitemap_index(host), headers={"content-type": "application/xml"})
        if path == "/sitemap_products_1.xml":
            return httpx.Response(
                200, text=pages.sitemap_products(host, products), headers={"content-type": "application/xml"}
            )
        if path.startswith("/products/") and path.endswith(".json"):
            handle = path.removeprefix("/products/").removesuffix(".json")
            for p in products:
                if p["handle"] == handle:
                    return httpx.Response(200, json={"product": pages.shopify_product_json(p, site)})
        return httpx.Response(404, text="Not found")

    def _crtsh(self, request: httpx.Request) -> httpx.Response:
        """crt.sh JSON: certificaten van domeinen die de zoekterm bevatten en vóór 'vandaag' zijn uitgegeven."""
        q = request.url.params.get("q", "").replace("%", "").lower()
        entries = []
        for i, site in enumerate(sites().values()):
            if q and q not in site.domain:
                continue
            issued = day_timestamp(min(site.launch_day, self.day), 3) - timedelta(days=1 if site.launch_day else 400)
            if site.launch_day > self.day:
                continue
            entries.append(
                {
                    "issuer_ca_id": 183267,
                    "issuer_name": "C=US, O=Let's Encrypt, CN=R11",
                    "common_name": site.domain,
                    "name_value": f"{site.domain}\nwww.{site.domain}",
                    "id": 10_000_000 + i,
                    "entry_timestamp": issued.strftime("%Y-%m-%dT%H:%M:%S.000"),
                    "not_before": issued.strftime("%Y-%m-%dT%H:%M:%S"),
                    "not_after": (issued + timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%S"),
                    "serial_number": f"{i:032x}",
                }
            )
        # ruis: mailservers en wildcard-certificaten
        entries.append(
            {
                "id": 1,
                "common_name": "*.example-cdn.net",
                "name_value": "*.example-cdn.net\nmail.example-cdn.net",
                "entry_timestamp": "2026-01-01T00:00:00.000",
            }
        )
        return httpx.Response(200, text=json.dumps(entries), headers={"content-type": "application/json"})

    # ── Meta Ad Library (graph.facebook.com/<versie>/ads_archive) ───────────
    def _meta(self, request: httpx.Request) -> httpx.Response:
        from trendscope.mockweb.ads_world import meta_ads_for, meta_pages, to_meta_json

        p = request.url.params
        token = p.get("access_token")
        if not token:
            return httpx.Response(
                400, json={"error": {"message": "An access token is required", "type": "OAuthException", "code": 104}}
            )
        if not request.url.path.endswith("/ads_archive"):
            return httpx.Response(404, json={"error": {"message": "Unknown path", "code": 803}})
        if "ad_reached_countries" not in p:
            return httpx.Response(400, json={"error": {"message": "ad_reached_countries is required", "code": 100}})
        countries = set(json.loads(p["ad_reached_countries"]))
        since = p.get("ad_delivery_date_min")
        status = p.get("ad_active_status", "ACTIVE")
        page_ids = json.loads(p["search_page_ids"]) if "search_page_ids" in p else list(meta_pages())
        term = (p.get("search_terms") or "").lower()
        matches = []
        for pid in page_ids:
            if pid not in meta_pages():
                continue
            page = meta_pages()[pid][1]
            for ad in meta_ads_for(pid, self.day):
                if not countries & set(ad["countries"]):
                    continue
                if status == "ACTIVE" and not ad["is_active"] or status == "INACTIVE" and ad["is_active"]:
                    continue
                if since and ad["end_date"] and ad["end_date"] < since:
                    continue
                if term and term not in f"{ad['body']} {ad['headline']}".lower():
                    continue
                matches.append(to_meta_json(ad, page, token))
        limit = min(int(p.get("limit", "25")), 250)
        offset = int(p.get("after") or 0)
        chunk = matches[offset : offset + limit]
        body: dict[str, object] = {"data": chunk}
        if offset + limit < len(matches):
            nxt = request.url.copy_set_param("after", str(offset + limit))
            body["paging"] = {"cursors": {"before": str(offset), "after": str(offset + limit)}, "next": str(nxt)}
        return httpx.Response(200, json=body)

    # ── TikTok Commercial Content API ──────────────────────────────────────
    def _tiktok(self, request: httpx.Request) -> httpx.Response:
        from trendscope.mockweb.ads_world import tiktok_ads_for, tiktok_advertisers

        if request.url.path == "/v2/oauth/token/":
            form = dict(x.split("=", 1) for x in request.content.decode().split("&") if "=" in x)
            if form.get("grant_type") != "client_credentials" or not form.get("client_secret"):
                return httpx.Response(401, json={"error": "invalid_client"})
            return httpx.Response(
                200, json={"access_token": "clt.mock-token", "expires_in": 7200, "token_type": "Bearer"}
            )
        if request.url.path != "/v2/research/adlib/ad/query/":
            return httpx.Response(404, json={"error": {"code": "not_found"}})
        if request.headers.get("authorization") != "Bearer clt.mock-token":
            return httpx.Response(401, json={"error": {"code": "access_token_invalid", "message": "invalid token"}})
        body = json.loads(request.content)
        f = body.get("filters", {})
        rng = f.get("ad_published_date_range", {})
        lo, hi = str(rng.get("min", "00000000")), str(rng.get("max", "99999999"))
        ids = f.get("advertiser_business_ids") or list(tiktok_advertisers())
        term = (body.get("search_term") or "").lower()
        results = []
        for biz in ids:
            store = tiktok_advertisers().get(biz)
            if not store or (term and term not in store.name.lower() and not any(term in n for n in store.niches)):
                continue
            for ad in tiktok_ads_for(biz, self.day):
                if lo <= ad["last_shown_date"] and ad["first_shown_date"] <= hi:
                    results.append(
                        {
                            "ad": ad,
                            "advertiser": {"business_id": biz, "business_name": store.name, "paid_for_by": store.name},
                        }
                    )
        offset = int(body.get("search_id") or 0)
        size = min(int(body.get("max_count", 20)), 50)
        chunk = results[offset : offset + size]
        more = offset + size < len(results)
        return httpx.Response(
            200,
            json={
                "data": {"ads": chunk, "has_more": more, "search_id": str(offset + size) if more else ""},
                "error": {"code": "ok", "message": "", "log_id": "mock"},
            },
        )

    # ── Marktplaatsen (AliExpress Affiliate, Amazon Creators API, CJ Dropshipping) ──────────
    def _marketplace(self, request: httpx.Request, host: str) -> httpx.Response:
        from trendscope.marketplaces.aliexpress import sign
        from trendscope.mockweb import marketplace_world as mw
        from trendscope.mockweb.images import product_png

        day = self.day
        path = request.url.path
        if host in ("ae-pic-a1.aliexpress-media.com", "m.media-amazon.com", "cf.cjdropshipping.com"):
            ext_id = path.rsplit("/", 1)[-1].removesuffix(".png")
            o = mw.offers_by_id().get(ext_id)
            if not o:
                return httpx.Response(404)
            return httpx.Response(
                200, content=product_png(o.item.title, o.variant), headers={"content-type": "image/png"}
            )

        if host == "api-sg.aliexpress.com":
            params = dict(request.url.params)
            given = params.pop("sign", "")
            if given != sign(params, "mock-aliexpress_app_secret"):
                return httpx.Response(
                    200,
                    json={
                        "error_response": {
                            "code": "IncompleteSignature",
                            "msg": "The request signature does not conform to platform standards",
                        }
                    },
                )
            size = int(params.get("page_size", "20"))
            page = int(params.get("page_no", "1"))
            hits = mw.search("aliexpress", params.get("keywords", ""))
            chunk = hits[(page - 1) * size : page * size]
            products = [
                {
                    "product_id": int(o.external_id),
                    "product_title": o.title,
                    "target_sale_price": f"{mw.price_on(o, day):.2f}",
                    "target_sale_price_currency": "EUR",
                    "target_original_price": f"{o.base_price * 1.8:.2f}",
                    "product_main_image_url": o.image_url,
                    "product_detail_url": f"https://www.aliexpress.com/item/{o.external_id}.html",
                    "evaluate_rate": f"{o.rating * 20:.1f}%",
                    "lastest_volume": mw.orders_on(o, day),
                    "shop_id": int(o.seller_id),
                    "shop_url": f"https://www.aliexpress.com/store/{o.seller_id}",
                    "first_level_category_name": o.item.niche,
                    "second_level_category_name": o.item.niche,
                    "ship_to_days": "7-15",
                }
                for o in chunk
            ]
            return httpx.Response(
                200,
                json={
                    "aliexpress_affiliate_product_query_response": {
                        "resp_result": {
                            "resp_code": 200,
                            "resp_msg": "Call succeeds",
                            "result": {
                                "current_page_no": page,
                                "current_record_count": len(products),
                                "total_record_count": len(hits),
                                "products": {"product": products},
                            },
                        }
                    }
                },
            )

        if host == "api.amazon.co.uk" and path == "/auth/o2/token":
            body = json.loads(request.content)
            if body.get("scope") != "creatorsapi::default" or body.get("grant_type") != "client_credentials":
                return httpx.Response(400, json={"error": "invalid_request"})
            return httpx.Response(200, json={"access_token": "Atc|mock", "token_type": "bearer", "expires_in": 3600})
        if host == "creatorsapi.amazon" and path == "/catalog/v1/searchItems":
            if request.headers.get("authorization") != "Bearer Atc|mock" or not request.headers.get("x-marketplace"):
                return httpx.Response(401, json={"errors": [{"code": "Unauthorized", "message": "invalid token"}]})
            body = json.loads(request.content)
            hits = mw.search("amazon", body.get("keywords", ""))[: int(body.get("itemCount", 10))]
            return httpx.Response(
                200,
                json={
                    "searchResult": {
                        "totalResultCount": len(hits),
                        "items": [
                            {
                                "asin": o.external_id,
                                "detailPageURL": f"https://www.amazon.de/dp/{o.external_id}?tag={body.get('partnerTag')}",
                                "itemInfo": {
                                    "title": {"displayValue": o.title},
                                    "byLineInfo": {"brand": {"displayValue": o.seller_name}},
                                },
                                "images": {"primary": {"medium": {"url": o.image_url, "width": 160, "height": 160}}},
                                "offersV2": {
                                    "listings": [
                                        {"price": {"money": {"amount": mw.price_on(o, day), "currency": "EUR"}}}
                                    ]
                                },
                                "browseNodeInfo": {
                                    "websiteSalesRank": {
                                        "salesRank": mw.rank_on(o, day),
                                        "displayName": "Home & Kitchen",
                                    }
                                },
                            }
                            for o in hits
                        ],
                    }
                },
            )

        if host == "developers.cjdropshipping.com":
            if path.endswith("/authentication/getAccessToken"):
                return httpx.Response(
                    200,
                    json={
                        "code": 200,
                        "result": True,
                        "message": "Success",
                        "data": {"accessToken": "cj-mock-token", "accessTokenExpiryDate": "2099-01-01"},
                    },
                )
            if request.headers.get("cj-access-token") != "cj-mock-token":
                return httpx.Response(200, json={"code": 1600001, "result": False, "message": "Invalid token"})
            if path.endswith("/product/list"):
                hits = mw.search("cj", request.url.params.get("productNameEn", ""))[
                    : int(request.url.params.get("pageSize", "20"))
                ]
                return httpx.Response(
                    200,
                    json={
                        "code": 200,
                        "result": True,
                        "message": "Success",
                        "data": {
                            "pageNum": 1,
                            "pageSize": len(hits),
                            "total": len(hits),
                            "list": [
                                {
                                    "pid": o.external_id,
                                    "productNameEn": o.title,
                                    "productSku": f"CJ{o.external_id[:6]}",
                                    "productImage": o.image_url,
                                    "sellPrice": f"{mw.price_on(o, day):.2f}",
                                    "categoryName": o.item.niche,
                                    "sourceFrom": "CN",
                                }
                                for o in hits
                            ],
                        },
                    },
                )
            if path.endswith("/logistic/freightCalculate"):
                vid = json.loads(request.content)["products"][0]["vid"]
                o = mw.offers_by_id().get(vid)
                if not o or not o.shipping:
                    return httpx.Response(200, json={"code": 200, "result": True, "data": []})
                cost, lo, hi = o.shipping
                return httpx.Response(
                    200,
                    json={
                        "code": 200,
                        "result": True,
                        "data": [
                            {"logisticName": "CJPacket Ordinary", "logisticPrice": cost, "logisticAging": f"{lo}-{hi}"},
                            {
                                "logisticName": "CJPacket Express",
                                "logisticPrice": round(cost * 2.2, 2),
                                "logisticAging": f"{max(3, lo - 3)}-{hi - 4}",
                            },
                        ],
                    },
                )
        return httpx.Response(404, json={"error": "not found"})

    # ── Trends: DataForSEO (Google Trends Explore) en Reddit ────────────────────────────────
    def _trends(self, request: httpx.Request, host: str) -> httpx.Response:
        import base64
        from datetime import date as _date

        from trendscope.mockweb import trend_world as tw
        from trendscope.mockweb.baseline import load_baseline

        today = load_baseline().day0 + timedelta(days=self.day)
        if host == "api.dataforseo.com":
            auth = request.headers.get("authorization", "")
            expected = "Basic " + base64.b64encode(b"mock-dataforseo_login:mock-dataforseo_password").decode()
            if auth != expected:
                return httpx.Response(401, json={"status_code": 40100, "status_message": "You are not authorized."})
            task = json.loads(request.content)[0]
            term = task["keywords"][0]
            country = tw.LOCATION_NAMES.get(task["location_name"], "US")
            start = _date.fromisoformat(task["date_from"])
            end = min(_date.fromisoformat(task["date_to"]), today)
            points = tw.interest_window(term, country, start, end) if term in tw.keyword_specs() else []
            data = [
                {
                    "date_from": d.isoformat(),
                    "date_to": d.isoformat(),
                    "timestamp": 0,
                    "missing_data": False,
                    "values": [v],
                }
                for d, v in points
            ]
            return httpx.Response(
                200,
                json={
                    "status_code": 20000,
                    "status_message": "Ok.",
                    "tasks": [
                        {
                            "status_code": 20000,
                            "status_message": "Ok.",
                            "result": [
                                {
                                    "keywords": [term],
                                    "location_code": 0,
                                    "items": [
                                        {
                                            "type": "google_trends_graph",
                                            "position": 1,
                                            "keywords": [term],
                                            "data": data,
                                            "averages": [],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                },
            )
        if host == "reddit.com" and request.url.path == "/api/v1/access_token":
            ok = (
                request.headers.get("authorization", "")
                == "Basic " + base64.b64encode(b"mock-reddit_client_id:mock-reddit_client_secret").decode()
            )
            if not ok or b"grant_type=client_credentials" not in request.content:
                return httpx.Response(401, json={"error": "invalid_grant"})
            return httpx.Response(
                200, json={"access_token": "reddit-mock-token", "token_type": "bearer", "expires_in": 86400}
            )
        if host == "oauth.reddit.com" and request.url.path == "/search":
            if request.headers.get("authorization") != "Bearer reddit-mock-token":
                return httpx.Response(401, json={"message": "Unauthorized", "error": 401})
            term = request.url.params.get("q", "").strip('"')
            posts = tw.reddit_posts(term, today)
            after = request.url.params.get("after")
            offset = int(after.removeprefix("t3_off")) if after else 0
            page = posts[offset : offset + 100]
            nxt = f"t3_off{offset + 100}" if offset + 100 < len(posts) else None
            return httpx.Response(
                200,
                json={
                    "kind": "Listing",
                    "data": {"after": nxt, "children": [{"kind": "t3", "data": {**p, "over_18": False}} for p in page]},
                },
            )
        return httpx.Response(404, json={"error": "not found"})

    # ── Social: TikTok-datapartner, YouTube Data API, Instagram Business Discovery ─────────────
    def _social(self, request: httpx.Request, host: str) -> httpx.Response:
        from datetime import UTC, datetime, time

        from trendscope.mockweb import tiktok_world as tt
        from trendscope.mockweb.baseline import load_baseline
        from trendscope.mockweb.images import product_png

        day = self.day
        day0 = load_baseline().day0
        path = request.url.path

        def ts(d: int, hour: int = 12) -> str:
            return datetime.combine(day0 + timedelta(days=d), time(hour), tzinfo=UTC).isoformat().replace("+00:00", "Z")

        if host in ("cdn.tiktok-data-partner.example", "i.ytimg.com"):
            seed = path.rsplit("/", 1)[-1].removesuffix(".png")
            p = tt.products_by_id().get(seed)
            return httpx.Response(
                200, content=product_png(p.image_seed if p else seed, 30), headers={"content-type": "image/png"}
            )

        if host == "api.tiktok-data-partner.example":
            if request.headers.get("x-api-key") != "mock-tiktok_partner_api_key":
                return httpx.Response(401, json={"error": "invalid api key"})

            def product_json(shop: tt.Shop, p: tt.ShopProduct) -> dict[str, object]:
                return {
                    "product_id": p.external_id,
                    "shop_id": shop.external_id,
                    "title": p.title,
                    "price": p.price,
                    "currency": "EUR",
                    "sold_count": tt.sold_on(p, day),
                    "commission_rate": p.commission,
                    "image_url": f"https://cdn.tiktok-data-partner.example/img/{p.external_id}.png",
                    "url": f"https://shop.tiktok.com/view/product/{p.external_id}",
                }

            parts = path.strip("/").split("/")
            if parts[:2] == ["v1", "categories"] and parts[-1] == "top":
                niche = parts[2]
                return httpx.Response(
                    200,
                    json={
                        "products": [product_json(s, p) for s, p in tt.top_products(niche, day)],
                        "creators": [{"handle": c.handle} for c in tt.top_creators(niche)],
                    },
                )
            if parts[:2] == ["v1", "shops"]:
                shop = next((s for s in tt.shops() if s.external_id == parts[2]), None)
                if not shop:
                    return httpx.Response(404, json={"error": "shop not found"})
                return httpx.Response(
                    200,
                    json={
                        "shop": {
                            "shop_id": shop.external_id,
                            "name": shop.name,
                            "country": shop.country,
                            "rating": shop.rating,
                            "followers": shop.followers,
                        },
                        "products": [product_json(shop, p) for p in shop.products],
                    },
                )
            if parts[:2] == ["v1", "creators"]:
                c = tt.creators_by_handle().get(parts[2])
                if not c:
                    return httpx.Response(404, json={"error": "creator not found"})
                return httpx.Response(
                    200,
                    json={
                        "creator": {
                            "handle": c.handle,
                            "name": c.name,
                            "country": c.country,
                            "followers": tt.followers_on(c, day),
                            "bio": f"{c.niche.replace('-', ' ')} finds ✨",
                            "avatar_url": None,
                            "contact": {"business_email": c.business_email} if c.business_email else {},
                        },
                        "videos": [
                            {
                                "video_id": v["id"],
                                "caption": v["caption"],
                                "posted_at": ts(int(v["posted_day"]), 17),
                                "views": v["views"],
                                "likes": v["likes"],
                                "comments": v["comments"],
                                "shares": v["shares"],
                                "product_id": v["product_id"],
                                "url": f"https://www.tiktok.com/@{c.handle}/video/{v['id']}",
                                "cover_url": f"https://cdn.tiktok-data-partner.example/cover/{v['cover_seed']}.png",
                            }
                            for v in tt.videos_until(c, day)
                        ],
                        "lives": [
                            {
                                "live_id": lv["id"],
                                "title": lv["title"],
                                "started_at": ts(int(lv["day"]), int(lv["hour"])),
                                "duration_min": lv["duration_min"],
                                "peak_viewers": lv["peak_viewers"],
                                "total_viewers": lv["total_viewers"],
                                "products": [
                                    {"product_id": x["product_id"], "units_sold": x["units"]} for x in lv["products"]
                                ],
                            }
                            for lv in tt.lives_until(c, day)
                        ],
                    },
                )
            return httpx.Response(404, json={"error": "not found"})

        # YouTube Data API v3 (host zonder "www.")
        if request.url.params.get("key") != "mock-youtube_api_key":
            return httpx.Response(400, json={"error": {"code": 400, "message": "API key not valid."}})
        if path == "/youtube/v3/search":
            q = request.url.params.get("q", "").lower()
            hits = [
                (c, v)
                for c in tt.creators()
                for v in tt.videos_until(c, day)
                if q.split(" review")[0] in str(v["cover_seed"]).lower()
            ][:25]
            return httpx.Response(
                200, json={"items": [{"id": {"kind": "youtube#video", "videoId": f"yt{v['id']}"}} for _, v in hits]}
            )
        if path == "/youtube/v3/videos":
            ids = request.url.params.get("id", "").split(",")
            items = []
            for c in tt.creators():
                for v in tt.videos_until(c, day):
                    if f"yt{v['id']}" in ids:
                        items.append(
                            {
                                "id": f"yt{v['id']}",
                                "snippet": {
                                    "channelId": f"UC{c.handle}",
                                    "channelTitle": c.name,
                                    "title": f"{v['cover_seed']} review: {str(v['caption']).split('#')[0].strip()}",
                                    "description": "",
                                    "publishedAt": ts(int(v["posted_day"])),
                                    "thumbnails": {"medium": {"url": f"https://i.ytimg.com/vi/{v['cover_seed']}.png"}},
                                },
                                "statistics": {
                                    "viewCount": str(int(v["views"]) // 3),
                                    "likeCount": str(int(v["likes"]) // 3),
                                    "commentCount": str(v["comments"]),
                                },
                            }
                        )
            return httpx.Response(200, json={"items": items})
        if path == "/youtube/v3/channels":
            ids = request.url.params.get("id", "").split(",")
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": f"UC{c.handle}",
                            "snippet": {"title": c.name, "customUrl": f"@{c.handle}", "country": c.country},
                            "statistics": {
                                "subscriberCount": str(tt.followers_on(c, day) // 4),
                                "videoCount": "120",
                                "hiddenSubscriberCount": False,
                            },
                        }
                        for c in tt.creators()
                        if f"UC{c.handle}" in ids
                    ]
                },
            )
        return httpx.Response(404, json={"error": {"code": 404, "message": "Not found"}})

    def _instagram(self, request: httpx.Request) -> httpx.Response:
        import re as _re
        from datetime import UTC, datetime, time

        from trendscope.mockweb import tiktok_world as tt
        from trendscope.mockweb.baseline import load_baseline

        if request.url.params.get("access_token") != "mock-instagram_access_token":
            return httpx.Response(
                400, json={"error": {"message": "Invalid OAuth access token.", "type": "OAuthException", "code": 190}}
            )
        m = _re.search(r"username\(([^)]+)\)", request.url.params.get("fields", ""))
        c = tt.creators_by_handle().get(m.group(1) if m else "")
        if not c:
            return httpx.Response(400, json={"error": {"message": "Invalid user id", "code": 110}})
        day0 = load_baseline().day0
        media = [
            {
                "caption": v["caption"],
                "like_count": int(v["likes"]) // 2,
                "comments_count": v["comments"],
                "timestamp": datetime.combine(
                    day0 + timedelta(days=int(v["posted_day"])), time(12), tzinfo=UTC
                ).strftime("%Y-%m-%dT%H:%M:%S+0000"),
                "permalink": f"https://www.instagram.com/p/{v['id']}/",
                "media_type": "VIDEO",
            }
            for v in tt.videos_until(c, self.day)[:12]
        ]
        return httpx.Response(
            200,
            json={
                "business_discovery": {
                    "username": c.handle,
                    "name": c.name,
                    "followers_count": int(tt.followers_on(c, self.day) * 0.6),
                    "media_count": 340,
                    "profile_picture_url": None,
                    "media": {"data": media},
                },
                "id": "17841400000000000",
            },
        )
