"""AliExpress Affiliate API (Open Platform, `aliexpress.affiliate.product.query`). Officiële API.

Ondertekening: HMAC-SHA256 met het app secret over de alfabetisch gesorteerde parameters
(sleutel + waarde aan elkaar), hexadecimaal in hoofdletters.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from collections.abc import Callable, Iterator
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode

from trendscope.core.http import PoliteHttpClient
from trendscope.marketplaces.records import Listing, parse_days, parse_percent

ENDPOINT = "https://api-sg.aliexpress.com/sync"
FIELDS = (
    "product_id,product_title,target_sale_price,target_sale_price_currency,target_original_price,"
    "product_main_image_url,product_detail_url,evaluate_rate,lastest_volume,shop_id,shop_url,"
    "first_level_category_name,second_level_category_name,ship_to_days"
)


def sign(params: dict[str, str], secret: str) -> str:
    message = "".join(f"{k}{params[k]}" for k in sorted(params))
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest().upper()


def _dec(raw: Any) -> Decimal | None:
    return Decimal(str(raw)) if raw not in (None, "") else None


def _rating(pct: float | None) -> float | None:
    return round(pct / 20, 2) if pct else None


def parse_response(payload: bytes) -> tuple[list[Listing], int]:
    data = json.loads(payload)
    if "error_response" in data:
        err = data["error_response"]
        raise RuntimeError(f"AliExpress API-fout {err.get('code')}: {err.get('msg')}")
    result = data["aliexpress_affiliate_product_query_response"]["resp_result"]
    if int(result.get("resp_code", 200)) != 200:
        raise RuntimeError(f"AliExpress resp_code {result.get('resp_code')}: {result.get('resp_msg')}")
    body = result.get("result") or {}
    items = (body.get("products") or {}).get("product") or []
    listings = [
        Listing(
            source="aliexpress",
            external_id=str(p["product_id"]),
            title=p["product_title"],
            url=p.get("product_detail_url"),
            price=_dec(p.get("target_sale_price")),
            original_price=_dec(p.get("target_original_price")),
            currency=p.get("target_sale_price_currency") or "USD",
            image_url=p.get("product_main_image_url"),
            orders_30d=int(p["lastest_volume"])
            if p.get("lastest_volume") not in (None, "")
            else None,  # sic: veldnaam van AliExpress
            rating=_rating(parse_percent(p.get("evaluate_rate"))),
            seller_id=str(p["shop_id"]) if p.get("shop_id") else None,
            seller_url=p.get("shop_url"),
            seller_positive_rate=parse_percent(p.get("evaluate_rate")),
            shipping_days=parse_days(p.get("ship_to_days")),
            ships_from="CN",
            category=p.get("second_level_category_name") or p.get("first_level_category_name"),
        )
        for p in items
    ]
    return listings, int(body.get("total_record_count") or len(listings))


def search(
    client: PoliteHttpClient,
    *,
    app_key: str,
    app_secret: str,
    keywords: str,
    ship_to: str = "NL",
    currency: str = "EUR",
    language: str = "EN",
    page_size: int = 50,
    max_pages: int = 2,
    clock: Callable[[], float] = time.time,
) -> Iterator[Listing]:
    for page in range(1, max_pages + 1):
        params = {
            "method": "aliexpress.affiliate.product.query",
            "app_key": app_key,
            "timestamp": str(int(clock() * 1000)),
            "sign_method": "sha256",
            "keywords": keywords,
            "fields": FIELDS,
            "page_no": str(page),
            "page_size": str(page_size),
            "sort": "LAST_VOLUME_DESC",
            "ship_to_country": ship_to,
            "target_currency": currency,
            "target_language": language,
        }
        params["sign"] = sign(params, app_secret)
        listings, total = parse_response(client.get(f"{ENDPOINT}?{urlencode(params)}").content)
        yield from listings
        if page * page_size >= total or not listings:
            return
