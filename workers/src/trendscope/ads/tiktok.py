"""TikTok Commercial Content API (onderzoekers-/bedrijfstoegang). Levert video's, afbeeldingen en bereik."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from datetime import date, datetime
from typing import Any

from trendscope.ads.records import AdRecord, Media
from trendscope.core.http import PoliteHttpClient

TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
QUERY_URL = "https://open.tiktokapis.com/v2/research/adlib/ad/query/"
FIELDS = [
    "ad.id",
    "ad.first_shown_date",
    "ad.last_shown_date",
    "ad.status",
    "ad.status_statement",
    "ad.videos",
    "ad.image_urls",
    "ad.reach",
    "advertiser.business_id",
    "advertiser.business_name",
    "advertiser.paid_for_by",
]
MAX_PAGES = 20


def get_token(client: PoliteHttpClient, client_key: str, client_secret: str) -> str:
    res = client.post(
        TOKEN_URL, data={"client_key": client_key, "client_secret": client_secret, "grant_type": "client_credentials"}
    )
    return str(json.loads(res.content)["access_token"])


def _tt_date(raw: Any) -> date | None:
    if not raw:
        return None
    s = str(raw)
    return datetime.strptime(s, "%Y%m%d").date() if s.isdigit() else date.fromisoformat(s[:10])


_UNITS = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}


def parse_bound(raw: str) -> int | None:
    m = re.fullmatch(r"\s*([\d.]+)\s*([kmb])?\s*\+?\s*", raw.lower())
    if not m:
        return None
    return int(float(m.group(1)) * _UNITS.get(m.group(2) or "", 1))


def parse_reach(raw: Any) -> tuple[int | None, int | None]:
    """'1K-10K' → (1000, 10000); '1M+' → (1000000, None); 12345 → (12345, 12345)."""
    value = raw.get("unique_users_seen") if isinstance(raw, dict) else raw
    if value is None:
        return None, None
    if isinstance(value, int | float):
        return int(value), int(value)
    parts = str(value).split("-")
    low = parse_bound(parts[0])
    high = parse_bound(parts[1]) if len(parts) > 1 else (low if "+" not in str(value) else None)
    return low, high


def parse_ad(item: dict[str, Any], today: date, country: str | None) -> AdRecord:
    ad, adv = item.get("ad", {}), item.get("advertiser", {})
    media = [
        Media(type="video", url=v["url"], poster=v.get("cover_image_url"))
        for v in ad.get("videos") or []
        if v.get("url")
    ]
    media += [Media(type="image", url=u) for u in ad.get("image_urls") or []]
    low, high = parse_reach(ad.get("reach"))
    last = _tt_date(ad.get("last_shown_date"))
    return AdRecord(
        platform="tiktok",
        external_id=str(ad["id"]),
        advertiser_external_id=str(adv.get("business_id")),
        advertiser_name=adv.get("business_name") or adv.get("paid_for_by") or str(adv.get("business_id")),
        format="video" if ad.get("videos") else "image" if ad.get("image_urls") else None,
        countries=[country] if country else [],
        publisher_platforms=["tiktok"],
        start_date=_tt_date(ad.get("first_shown_date")),
        end_date=None if str(ad.get("status", "")).lower() == "active" else last,
        is_active=str(ad.get("status", "")).lower() == "active",
        impressions_low=low,
        impressions_high=high,
        media=media,
    )


def fetch_ads(
    client: PoliteHttpClient,
    *,
    token: str,
    today: date,
    since: date,
    country: str,
    search_term: str | None = None,
    business_ids: list[str] | None = None,
) -> Iterator[AdRecord]:
    filters: dict[str, Any] = {
        "ad_published_date_range": {"min": since.strftime("%Y%m%d"), "max": today.strftime("%Y%m%d")},
        "country_code": country,
    }
    if business_ids:
        filters["advertiser_business_ids"] = business_ids
    body: dict[str, Any] = {"filters": filters, "max_count": 50}
    if search_term:
        body["search_term"] = search_term
    url = f"{QUERY_URL}?fields={','.join(FIELDS)}"
    for _ in range(MAX_PAGES):
        data = json.loads(client.post(url, json=body, headers={"Authorization": f"Bearer {token}"}).content)
        err = data.get("error") or {}
        if err.get("code") not in (None, "ok"):
            raise RuntimeError(f"TikTok API-fout {err.get('code')}: {err.get('message')}")
        payload = data.get("data") or {}
        for item in payload.get("ads", []):
            yield parse_ad(item, today, country)
        if not payload.get("has_more"):
            return
        body["search_id"] = payload.get("search_id")
