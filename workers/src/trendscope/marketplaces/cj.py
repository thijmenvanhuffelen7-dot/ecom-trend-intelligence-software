"""CJ Dropshipping API v2. Officiële API (account + API-key)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode

from trendscope.core.http import PoliteHttpClient
from trendscope.marketplaces.records import Listing, parse_days

BASE = "https://developers.cjdropshipping.com/api2.0/v1"


def _check(data: dict[str, Any]) -> Any:
    if data.get("code") != 200 or data.get("result") is False:
        raise RuntimeError(f"CJ API-fout {data.get('code')}: {data.get('message')}")
    return data.get("data")


def get_token(client: PoliteHttpClient, api_key: str) -> str:
    data = _check(json.loads(client.post(f"{BASE}/authentication/getAccessToken", json={"apiKey": api_key}).content))
    return str(data["accessToken"])


def parse_list(payload: bytes) -> list[Listing]:
    data = _check(json.loads(payload)) or {}
    return [
        Listing(
            source="cj",
            external_id=str(p["pid"]),
            title=p.get("productNameEn") or p.get("productName") or str(p["pid"]),
            url=f"https://cjdropshipping.com/product/-p-{p['pid']}.html",
            price=Decimal(str(p["sellPrice"]).split("-")[0].strip()) if p.get("sellPrice") not in (None, "") else None,
            currency="USD",
            image_url=p.get("productImage"),
            seller_id="cj",
            seller_name="CJ Dropshipping",
            category=p.get("categoryName"),
            ships_from=p.get("sourceFrom") or "CN",
        )
        for p in data.get("list") or []
    ]


def freight(
    client: PoliteHttpClient, token: str, vid: str, to_country: str, from_country: str = "CN"
) -> tuple[Decimal, tuple[int, int] | None] | None:
    """Goedkoopste verzendoptie (prijs, levertijd) voor één stuk."""
    body = {"startCountryCode": from_country, "endCountryCode": to_country, "products": [{"quantity": 1, "vid": vid}]}
    options = (
        _check(
            json.loads(
                client.post(f"{BASE}/logistic/freightCalculate", json=body, headers={"CJ-Access-Token": token}).content
            )
        )
        or []
    )
    if not options:
        return None
    best = min(options, key=lambda o: float(o.get("logisticPrice") or 1e9))
    return Decimal(str(best["logisticPrice"])), parse_days(best.get("logisticAging"))


def search(
    client: PoliteHttpClient, *, token: str, keywords: str, ship_to: str = "NL", page_size: int = 20
) -> Iterator[Listing]:
    q = urlencode({"productNameEn": keywords, "pageNum": 1, "pageSize": page_size})
    for listing in parse_list(client.get(f"{BASE}/product/list?{q}", headers={"CJ-Access-Token": token}).content):
        shipping = freight(client, token, listing.external_id, ship_to)
        if shipping:
            listing.shipping_cost, listing.shipping_days = shipping
        yield listing
