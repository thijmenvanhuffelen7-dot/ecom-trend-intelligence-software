"""Meta Ad Library API (`ads_archive`). Officiële API; commerciële ads alleen met EU-levering (DSA).

Let op: de API levert geen mediabestanden en geen landingspagina-URL. Het domein staat meestal in
`ad_creative_link_captions`; beeld/video halen we (waar toegestaan) uit de snapshot (zie media.capture).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import date
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from trendscope.ads.records import AdRecord
from trendscope.core.http import PoliteHttpClient

FIELDS = [
    "id",
    "ad_creation_time",
    "ad_creative_bodies",
    "ad_creative_link_captions",
    "ad_creative_link_descriptions",
    "ad_creative_link_titles",
    "ad_delivery_start_time",
    "ad_delivery_stop_time",
    "ad_snapshot_url",
    "page_id",
    "page_name",
    "publisher_platforms",
    "languages",
    "eu_total_reach",
    "target_ages",
    "target_gender",
    "age_country_gender_reach_breakdown",
    "beneficiary_payers",
]
EU_COUNTRIES = ["NL", "BE", "DE", "FR", "ES", "IT", "AT", "IE", "DK", "SE", "FI", "PL", "PT"]
PAGE_LIMIT = 250
MAX_PAGES = 20


def strip_token(url: str | None) -> str | None:
    """Snapshot-URL's bevatten het access token: nooit opslaan of loggen."""
    if not url:
        return None
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != "access_token"]
    return urlunsplit(parts._replace(query=urlencode(query)))


def _date(raw: Any) -> date | None:
    return date.fromisoformat(str(raw)[:10]) if raw else None


def _first(values: Any) -> str | None:
    return values[0] if isinstance(values, list) and values else None


def parse_ad(raw: dict[str, Any], today: date) -> AdRecord:
    stop = _date(raw.get("ad_delivery_stop_time"))
    countries = sorted(
        {str(c.get("country")).upper() for c in raw.get("age_country_gender_reach_breakdown") or [] if c.get("country")}
    )
    ages = raw.get("target_ages") or []
    return AdRecord(
        platform="meta",
        external_id=str(raw["id"]),
        advertiser_external_id=str(raw["page_id"]),
        advertiser_name=raw.get("page_name") or str(raw["page_id"]),
        body=_first(raw.get("ad_creative_bodies")),
        headline=_first(raw.get("ad_creative_link_titles")),
        link_caption=_first(raw.get("ad_creative_link_captions")),
        link_description=_first(raw.get("ad_creative_link_descriptions")),
        countries=countries,
        languages=list(raw.get("languages") or []),
        publisher_platforms=[p.lower() for p in raw.get("publisher_platforms") or []],
        start_date=_date(raw.get("ad_delivery_start_time") or raw.get("ad_creation_time")),
        end_date=stop,
        is_active=stop is None or stop >= today,
        snapshot_url=strip_token(raw.get("ad_snapshot_url")),
        eu_reach=int(raw["eu_total_reach"]) if raw.get("eu_total_reach") is not None else None,
        target_ages=f"{ages[0]}–{ages[-1]}" if len(ages) >= 2 else (ages[0] if ages else None),
        target_gender=raw.get("target_gender"),
    )


def parse_page(payload: bytes, today: date) -> tuple[list[AdRecord], str | None]:
    data = json.loads(payload)
    if "error" in data:
        raise RuntimeError(f"Meta API-fout {data['error'].get('code')}: {data['error'].get('message')}")
    next_url = (data.get("paging") or {}).get("next")
    return [parse_ad(a, today) for a in data.get("data", [])], next_url


def fetch_ads(
    client: PoliteHttpClient,
    *,
    token: str,
    version: str,
    today: date,
    page_ids: list[str] | None = None,
    search_terms: str | None = None,
    countries: list[str] | None = None,
    since: date | None = None,
    active_status: str = "ALL",
) -> Iterator[AdRecord]:
    params: dict[str, str] = {
        "access_token": token,
        "ad_type": "ALL",
        "ad_active_status": active_status,
        "ad_reached_countries": json.dumps(countries or EU_COUNTRIES),
        "fields": ",".join(FIELDS),
        "limit": str(PAGE_LIMIT),
    }
    if page_ids:
        params["search_page_ids"] = json.dumps(page_ids)
    if search_terms:
        params["search_terms"] = search_terms
    if since:
        params["ad_delivery_date_min"] = since.isoformat()
    url: str | None = f"https://graph.facebook.com/{version}/ads_archive?{urlencode(params)}"
    for _ in range(MAX_PAGES):
        if not url:
            return
        ads, url = parse_page(client.get(url).content, today)
        yield from ads
