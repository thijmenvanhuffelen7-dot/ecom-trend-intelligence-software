"""Amazon Creators API (opvolger van PA-API 5, dat in mei 2026 is uitgezet). Officiële API.

- Token: Login with Amazon, client credentials, scope `creatorsapi::default` (EU: api.amazon.co.uk).
- Zoeken: POST https://creatorsapi.amazon/catalog/v1/searchItems met `x-marketplace`.
- Resources (lowerCamelCase): itemInfo.title, images.primary.medium, offersV2.listings.price,
  browseNodeInfo.websiteSalesRank.
De parser accepteert bewust meerdere paden: de exacte responsstructuur moet na toegang tot de
referentie-docs geverifieerd worden (zie docs/sources/amazon_creators_api.md).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

from trendscope.core.http import PoliteHttpClient
from trendscope.marketplaces.records import Listing

TOKEN_URLS = {
    "eu": "https://api.amazon.co.uk/auth/o2/token",
    "na": "https://api.amazon.com/auth/o2/token",
    "fe": "https://api.amazon.co.jp/auth/o2/token",
}
SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems"
RESOURCES = [
    "itemInfo.title",
    "itemInfo.byLineInfo",
    "images.primary.medium",
    "offersV2.listings.price",
    "browseNodeInfo.websiteSalesRank",
]
CURRENCY = {
    "www.amazon.de": "EUR",
    "www.amazon.nl": "EUR",
    "www.amazon.fr": "EUR",
    "www.amazon.co.uk": "GBP",
    "www.amazon.com": "USD",
}

# BSR → maandverkopen: grove machtswet per hoofdcategorie (eenheden ≈ a · rank^-b). Altijd 'low' betrouwbaar.
BSR_MODEL: dict[str, tuple[float, float]] = {
    "default": (30_000, 0.8),
    "home & kitchen": (45_000, 0.8),
    "küche, haushalt & wohnen": (45_000, 0.8),
    "beauty": (32_000, 0.8),
    "sports & outdoors": (25_000, 0.8),
    "pet supplies": (18_000, 0.8),
    "electronics": (35_000, 0.82),
    "baby": (15_000, 0.78),
    "fashion": (28_000, 0.8),
}


def get_token(client: PoliteHttpClient, client_id: str, client_secret: str, region: str = "eu") -> str:
    res = client.post(
        TOKEN_URLS[region],
        json={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "creatorsapi::default",
        },
    )
    return str(json.loads(res.content)["access_token"])


def _get(obj: Any, *path: str) -> Any:
    for p in path:
        if isinstance(obj, list):
            obj = obj[0] if obj else None
        if not isinstance(obj, dict):
            return None
        obj = obj.get(p)
    return obj


def estimate_monthly_sales(rank: int | None, category: str | None) -> dict[str, Any] | None:
    if not rank or rank <= 0:
        return None
    a, b = BSR_MODEL.get((category or "").lower(), BSR_MODEL["default"])
    units = a * rank**-b
    return {
        "value": round(units),
        "low": round(units * 0.5),
        "high": round(units * 2),
        "confidence": "low",
        "method": f"BSR-model ({category or 'algemeen'}): {a:.0f}·rank^-{b}",
    }


def parse_items(payload: bytes, marketplace: str) -> list[Listing]:
    data = json.loads(payload)
    if data.get("errors"):
        e = data["errors"][0]
        raise RuntimeError(f"Amazon Creators API-fout {e.get('code')}: {e.get('message')}")
    items = _get(data, "searchResult", "items") or _get(data, "itemsResult", "items") or []
    out = []
    for it in items:
        price = _get(it, "offersV2", "listings", "price", "money", "amount") or _get(
            it, "offersV2", "listings", "price", "amount"
        )
        currency = (
            _get(it, "offersV2", "listings", "price", "money", "currency")
            or _get(it, "offersV2", "listings", "price", "currency")
            or CURRENCY.get(marketplace, "EUR")
        )
        rank = _get(it, "browseNodeInfo", "websiteSalesRank", "salesRank")
        category = _get(it, "browseNodeInfo", "websiteSalesRank", "displayName") or _get(
            it, "browseNodeInfo", "websiteSalesRank", "contextFreeName"
        )
        out.append(
            Listing(
                source="amazon",
                external_id=str(it["asin"]),
                title=_get(it, "itemInfo", "title", "displayValue") or str(it["asin"]),
                url=it.get("detailPageURL"),
                price=Decimal(str(price)) if price is not None else None,
                currency=currency,
                image_url=_get(it, "images", "primary", "medium", "url")
                or _get(it, "images", "primary", "large", "url"),
                sales_rank=int(rank) if rank else None,
                sales_rank_category=category,
                seller_name=_get(it, "itemInfo", "byLineInfo", "brand", "displayValue"),
            )
        )
    return out


def search(
    client: PoliteHttpClient,
    *,
    token: str,
    partner_tag: str,
    keywords: str,
    marketplace: str = "www.amazon.de",
    item_count: int = 10,
    pages: int = 1,
) -> Iterator[Listing]:
    for page in range(1, pages + 1):
        body = {
            "keywords": keywords,
            "marketplace": marketplace,
            "partnerTag": partner_tag,
            "partnerType": "Associates",
            "itemCount": item_count,
            "itemPage": page,
            "resources": RESOURCES,
        }
        res = client.post(
            SEARCH_URL, json=body, headers={"Authorization": f"Bearer {token}", "x-marketplace": marketplace}
        )
        yield from parse_items(res.content, marketplace)
