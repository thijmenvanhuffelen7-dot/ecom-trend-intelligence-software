"""TikTok Shop- en creatordata via een gelicentieerde datapartner.

TikTok biedt derden geen officiële API voor Shop-verkopen of andermans creatorstatistieken (de Shop Partner API is
voor verkopers zelf; de Research API alleen voor onderzoek). Daarom: een partner met eigen licentie, achter een
uitschakelbare connector. Het contract hieronder is ons eigen, neutrale formaat; een adapter per partner zet hun
respons hierin om. Basis-URL en sleutel via TIKTOK_PARTNER_BASE_URL en TIKTOK_PARTNER_API_KEY.

GET {base}/v1/categories/{niche}/top?country=NL     → {"products": [...], "creators": [...]}
GET {base}/v1/shops/{shop_id}                        → {"shop": {...}, "products": [...]}
GET {base}/v1/creators/{handle}                      → {"creator": {...}, "videos": [...], "lives": [...]}
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any
from urllib.parse import quote

from trendscope.core.http import PoliteHttpClient


@dataclass(frozen=True)
class PShopProduct:
    product_id: str
    shop_id: str
    title: str
    price: Decimal
    currency: str
    sold_count: int
    commission_rate: float | None
    image_url: str | None
    url: str | None


@dataclass(frozen=True)
class PShop:
    shop_id: str
    name: str
    country: str | None
    rating: float | None
    followers: int | None
    products: list[PShopProduct] = field(default_factory=list)


@dataclass(frozen=True)
class PVideo:
    video_id: str
    caption: str
    posted_at: datetime
    views: int
    likes: int
    comments: int
    shares: int
    product_id: str | None
    cover_url: str | None
    url: str


@dataclass(frozen=True)
class PLive:
    live_id: str
    title: str
    started_at: datetime
    duration_min: int
    peak_viewers: int
    total_viewers: int
    products: list[tuple[str, int]]  # (product_id, verkochte stuks volgens de teller)


@dataclass(frozen=True)
class PCreator:
    handle: str
    name: str
    country: str | None
    bio: str | None
    followers: int
    avatar_url: str | None
    business_email: str | None  # alleen als publiek, zakelijk gepubliceerd


def _get(client: PoliteHttpClient, url: str, key: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(client.get(url, headers={"X-Api-Key": key}).content)
    if data.get("error"):
        raise RuntimeError(f"Partner-API: {data['error']}")
    return data


def _product(p: dict[str, Any]) -> PShopProduct:
    return PShopProduct(
        product_id=str(p["product_id"]),
        shop_id=str(p["shop_id"]),
        title=str(p["title"])[:300],
        price=Decimal(str(p["price"])),
        currency=str(p.get("currency") or "EUR"),
        sold_count=int(p.get("sold_count") or 0),
        commission_rate=float(p["commission_rate"]) if p.get("commission_rate") is not None else None,
        image_url=p.get("image_url"),
        url=p.get("url"),
    )


def _ts(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


def parse_category(payload: dict[str, Any]) -> tuple[list[PShopProduct], list[str]]:
    return [_product(p) for p in payload.get("products", [])], [str(c["handle"]) for c in payload.get("creators", [])]


def parse_shop(payload: dict[str, Any]) -> PShop:
    s = payload["shop"]
    return PShop(
        shop_id=str(s["shop_id"]),
        name=str(s["name"]),
        country=s.get("country"),
        rating=s.get("rating"),
        followers=s.get("followers"),
        products=[_product(p) for p in payload.get("products", [])],
    )


def parse_creator(payload: dict[str, Any]) -> tuple[PCreator, list[PVideo], list[PLive]]:
    c = payload["creator"]
    creator = PCreator(
        handle=str(c["handle"]),
        name=str(c.get("name") or c["handle"]),
        country=c.get("country"),
        bio=c.get("bio"),
        followers=int(c.get("followers") or 0),
        avatar_url=c.get("avatar_url"),
        business_email=(c.get("contact") or {}).get("business_email"),
    )
    videos = [
        PVideo(
            video_id=str(v["video_id"]),
            caption=str(v.get("caption") or "")[:2000],
            posted_at=_ts(v["posted_at"]),
            views=int(v.get("views") or 0),
            likes=int(v.get("likes") or 0),
            comments=int(v.get("comments") or 0),
            shares=int(v.get("shares") or 0),
            product_id=v.get("product_id"),
            cover_url=v.get("cover_url"),
            url=str(v.get("url") or ""),
        )
        for v in payload.get("videos", [])
    ]
    lives = [
        PLive(
            live_id=str(lv["live_id"]),
            title=str(lv.get("title") or ""),
            started_at=_ts(lv["started_at"]),
            duration_min=int(lv.get("duration_min") or 0),
            peak_viewers=int(lv.get("peak_viewers") or 0),
            total_viewers=int(lv.get("total_viewers") or 0),
            products=[(str(p["product_id"]), int(p.get("units_sold") or 0)) for p in lv.get("products", [])],
        )
        for lv in payload.get("lives", [])
    ]
    return creator, videos, lives


def category_top(
    client: PoliteHttpClient, base: str, key: str, niche: str, country: str
) -> tuple[list[PShopProduct], list[str]]:
    return parse_category(_get(client, f"{base}/v1/categories/{quote(niche)}/top?country={country}", key))


def shop(client: PoliteHttpClient, base: str, key: str, shop_id: str) -> PShop:
    return parse_shop(_get(client, f"{base}/v1/shops/{quote(shop_id)}", key))


def creator(client: PoliteHttpClient, base: str, key: str, handle: str) -> tuple[PCreator, list[PVideo], list[PLive]]:
    return parse_creator(_get(client, f"{base}/v1/creators/{quote(handle)}", key))
