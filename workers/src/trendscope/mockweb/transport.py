"""httpx-transport die het nep-internet serveert. Wordt in mock-modus in de PoliteHttpClient gehangen."""

from __future__ import annotations

import json
import zlib
from collections.abc import Callable
from datetime import timedelta

import httpx

from trendscope.mockweb import pages
from trendscope.mockweb.world import catalog, current_day, day_timestamp, sites


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
        if host == "crt.sh":
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nAllow: /\n")
            return self._crtsh(request)
        site = sites().get(host)
        if site is None or self.day < site.launch_day:
            raise httpx.ConnectError(f"Name or service not known: {host}", request=request)
        path = request.url.path
        day = self.day
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
