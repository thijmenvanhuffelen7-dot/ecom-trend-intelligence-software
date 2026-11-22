"""Ads op het nep-internet: Meta-pagina's, TikTok- en Google-adverteerders die dag na dag veranderen.

Zelfde principe als `world.py`: de staat op dag *d* is deterministisch (eigen Random per pagina per dag).
"""

from __future__ import annotations

import random
import zlib
from datetime import date, timedelta
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

from trendscope.mockweb.baseline import StoreBaseline, load_baseline
from trendscope.mockweb.world import catalog, sites
from trendscope.seed import catalog as C

NEW_AD_RATE = {"scaling": 0.7, "new": 0.6, "ad_peak": 0.9, "stable": 0.25, "declining": 0.08}
STOP_RATE = {"scaling": 0.02, "new": 0.02, "ad_peak": 0.015, "stable": 0.04, "declining": 0.09}
EU = ["NL", "BE", "DE", "FR", "ES", "IT", "AT", "SE"]


def _crc(*parts: object) -> int:
    return zlib.crc32(":".join(map(str, parts)).encode())


def day_date(day: int) -> date:
    return load_baseline().day0 + timedelta(days=day)


def _ad_media(emoji: str, color: str, hook: str, fmt: str) -> list[dict[str, Any]]:
    url = f"/media/demo/ad.svg?e={quote(emoji)}&c={quote(color)}&t={quote(hook)}&v={int(fmt == 'video')}"
    return [{"type": "video" if fmt == "video" else "image", "url": url, "poster": None, "storage_key": None}]


def _emoji_of(image_url: str) -> str:
    q = parse_qs(urlsplit(image_url).query)
    return q.get("e", ["✨"])[0]


# ── Meta ─────────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def meta_pages() -> dict[str, tuple[StoreBaseline, dict[str, Any]]]:
    """page_id → (winkel, pagina). Nog onontdekte Shopify-winkels krijgen een pagina die na lancering adverteert."""
    pages: dict[str, tuple[StoreBaseline, dict[str, Any]]] = {}
    for store in sites().values():
        for page in store.pages:
            pages[page["page_id"]] = (store, page)
        if not store.pages and store.platform == "shopify":
            pid = str(200_000_000_000 + _crc(store.domain) % 10**9)
            pages[pid] = (store, {"page_id": pid, "name": store.name, "ads": [], "starts_on": store.launch_day + 1})
    return pages


def _new_meta_ad(
    store: StoreBaseline, page: dict[str, Any], day: int, k: int, r: random.Random, live: list[dict[str, Any]]
) -> dict[str, Any]:
    ext = f"95{int(page['page_id']) % 10**7:07d}{day:03d}{k}"
    start = day_date(day)
    active_creatives = [a for a in live if a["is_active"]]
    if active_creatives and r.random() < 0.35:
        src = r.choice(active_creatives)  # opschalen: nieuwe variant van een lopende creative
        body, headline, hook, fmt, emoji, landing = (
            src["body"],
            src["headline"],
            src["hook"],
            src["format"],
            src["emoji"],
            src["landing_url"],
        )
    else:
        products = catalog(store.domain, day) or [{"title": "Bestseller", "handle": "bestseller", "image": ""}]
        product = r.choice(products[:12])
        title = product["title"].split(" — ")[0]
        hook = r.choice(C.HOOKS).format(p=title.split()[-1].lower())
        fmt = r.choices(["video", "image", "carousel"], weights=[6, 3, 1])[0]
        body = f"{hook}\n\n{title} — free shipping today only. ⭐⭐⭐⭐⭐ 4.8/5 from 2,000+ customers.{C.hashtags(title, ext)}"
        headline, emoji = title, _emoji_of(product.get("image", ""))
        landing = f"https://{store.domain}/products/{product['handle']}"
    countries = sorted(set(r.sample(EU, r.randint(1, 3))) | ({store.country} if store.country in EU else set()))
    return {
        "external_id": ext,
        "body": body,
        "headline": headline,
        "hook": hook,
        "format": fmt,
        "emoji": emoji,
        "landing_url": landing,
        "link_caption": store.domain.upper(),
        "link_description": "Free shipping · 30-day returns",
        "cta": r.choice(C.CTAS),
        "countries": countries,
        "languages": [store.language],
        "publisher_platforms": sorted(
            r.sample(["facebook", "instagram", "messenger", "audience_network"], r.randint(1, 3))
        ),
        "start_date": start.isoformat(),
        "end_date": None,
        "is_active": True,
        "eu_reach": r.randint(80, 900),
        "target_ages": "18–65+",
        "target_gender": "All",
        "color": store.color,
    }


@lru_cache(maxsize=8192)
def _meta_state(page_id: str, day: int) -> tuple[dict[str, Any], ...]:
    store, page = meta_pages()[page_id]
    if day <= 0:
        return tuple(dict(a) for a in page["ads"])
    # ondiepe kopie volstaat: we wijzigen alleen scalaire velden (status, einddatum, bereik)
    ads = [dict(a) for a in _meta_state(page_id, day - 1)]
    if day < page.get("starts_on", 0) or day < store.launch_day:
        return tuple(ads)
    r = random.Random(f"meta:{page_id}:{day}")
    arch = store.arch if store.arch in NEW_AD_RATE else "stable"
    today = day_date(day)
    for a in ads:
        if a["is_active"]:
            if r.random() < STOP_RATE[arch]:
                a["is_active"], a["end_date"] = False, today.isoformat()
            else:
                a["eu_reach"] = int((a.get("eu_reach") or 0) * r.uniform(1.02, 1.07) + r.randint(20, 400))
    n_new = int(r.random() < NEW_AD_RATE[arch]) + int(r.random() < NEW_AD_RATE[arch] / 2) + (2 if not ads else 0)
    for k in range(n_new):
        ads.append(_new_meta_ad(store, page, day, k, r, ads))
    return tuple(ads)


def meta_ads_for(page_id: str, day: int) -> list[dict[str, Any]]:
    return list(_meta_state(page_id, day)) if page_id in meta_pages() else []


def to_meta_json(ad: dict[str, Any], page: dict[str, Any], token: str) -> dict[str, Any]:
    """Zoals `ads_archive` het teruggeeft (alleen de velden die wij opvragen)."""
    return {
        "id": ad["external_id"],
        "ad_creation_time": ad["start_date"],
        "ad_creative_bodies": [ad["body"]],
        "ad_creative_link_captions": [ad["link_caption"]],
        "ad_creative_link_descriptions": [ad["link_description"]],
        "ad_creative_link_titles": [ad["headline"]],
        "ad_delivery_start_time": ad["start_date"],
        **({"ad_delivery_stop_time": ad["end_date"]} if ad["end_date"] else {}),
        "ad_snapshot_url": f"https://www.facebook.com/ads/archive/render_ad/?id={ad['external_id']}&access_token={token}",
        "page_id": page["page_id"],
        "page_name": page["name"],
        "publisher_platforms": [p.upper() for p in ad["publisher_platforms"]],
        "languages": ad["languages"],
        "eu_total_reach": ad["eu_reach"],
        "target_ages": ["18", "65+"],
        "target_gender": ad["target_gender"],
        "age_country_gender_reach_breakdown": [{"country": c, "age_gender_breakdowns": []} for c in ad["countries"]],
        "beneficiary_payers": [{"payer": page["name"], "beneficiary": page["name"]}],
    }


@lru_cache(maxsize=64)
def _meta_index(day: int) -> dict[str, dict[str, Any]]:
    return {ad["external_id"]: ad for pid in meta_pages() for ad in meta_ads_for(pid, day)}


def meta_snapshot_html(ad_id: str, day: int) -> str | None:
    ad = _meta_index(day).get(ad_id)
    if ad:
        m = (ad.get("media") or _ad_media(ad.get("emoji", "✨"), ad.get("color", "#333"), ad["hook"], ad["format"]))[0]
        tag = (
            f'<video poster="{m["url"]}" src="{m["url"]}"></video>'
            if m["type"] == "video"
            else f'<img class="creative" src="{m["url"]}">'
        )
        return (
            f'<html><body><div class="ad" data-format="{ad["format"]}"><p class="body">{ad["body"]}</p>{tag}'
            f'<a href="{ad["landing_url"]}" class="cta">{ad["cta"]}</a><span class="title">{ad["headline"]}</span></div></body></html>'
        )
    return None


# ── TikTok ───────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def tiktok_advertisers() -> dict[str, StoreBaseline]:
    return {
        f"7{_crc('tt', s.domain) % 10**12:012d}": s
        for s in sites().values()
        if s.platform == "shopify" and _crc("tt", s.domain) % 3 == 0
    }


@lru_cache(maxsize=8192)
def _tiktok_state(biz_id: str, day: int) -> tuple[dict[str, Any], ...]:
    store = tiktok_advertisers()[biz_id]
    ads = [dict(a) for a in _tiktok_state(biz_id, day - 1)] if day > -30 else []
    # bekende winkels adverteerden al vóór day0; nieuwe pas vanaf hun lancering
    if day < store.launch_day - (20 if store.launch_day == 0 else 0):
        return tuple(ads)
    r = random.Random(f"tiktok:{biz_id}:{day}")
    for a in ads:
        if a["status"] == "active" and r.random() < 0.05:
            a["status"], a["last_shown_date"] = "inactive", (day_date(day) - timedelta(days=1)).strftime("%Y%m%d")
        elif a["status"] == "active":
            a["last_shown_date"] = day_date(day).strftime("%Y%m%d")
    if r.random() < 0.35:
        products = catalog(store.domain, max(day, store.launch_day)) or [{"title": "Bestseller", "image": ""}]
        p = r.choice(products[:10])
        hook = r.choice(C.HOOKS).format(p=p["title"].split()[-1].lower())
        url = f"/media/demo/ad.svg?e={quote(_emoji_of(p.get('image', '')))}&c={quote(store.color)}&t={quote(hook)}&v=1"
        low = r.choice([1_000, 10_000, 100_000])
        ads.append(
            {
                "id": f"18{_crc(biz_id, day) % 10**9:09d}{len(ads):03d}",
                "first_shown_date": day_date(day).strftime("%Y%m%d"),
                "last_shown_date": day_date(day).strftime("%Y%m%d"),
                "status": "active",
                "status_statement": "",
                "videos": [{"url": url, "cover_image_url": url}],
                "image_urls": [],
                "reach": {"unique_users_seen": f"{low // 1000}K-{low * 10 // 1000}K"},
            }
        )
    return tuple(ads)


def tiktok_ads_for(biz_id: str, day: int) -> list[dict[str, Any]]:
    return list(_tiktok_state(biz_id, day)) if biz_id in tiktok_advertisers() else []


# ── Google (BigQuery-rijen) ──────────────────────────────────────────
@lru_cache(maxsize=1)
def google_advertisers() -> dict[str, StoreBaseline]:
    return {
        f"AR{_crc('g', s.domain) % 10**17:017d}": s
        for s in sites().values()
        if s.platform == "shopify" and _crc("g", s.domain) % 4 == 0 and s.launch_day == 0
    }


def google_rows(advertiser_ids: list[str], since: date, day: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for adv_id in advertiser_ids:
        store = google_advertisers().get(adv_id)
        if not store:
            continue
        for k in range(3 + _crc(adv_id) % 5):
            r = random.Random(f"g:{adv_id}:{k}")
            first = day_date(-r.randint(10, 120))
            last = day_date(day) if r.random() < 0.7 else first + timedelta(days=r.randint(5, 60))
            if last < since:
                continue
            cid = f"CR{_crc(adv_id, k) % 10**17:017d}"
            for region in r.sample(EU, r.randint(1, 3)):
                low = r.choice([0, 1_000, 10_000, 100_000])
                rows.append(
                    {
                        "advertiser_id": adv_id,
                        "advertiser_disclosed_name": store.name,
                        "advertiser_location": store.country,
                        "creative_id": cid,
                        "creative_page_url": f"https://adstransparency.google.com/advertiser/{adv_id}/creative/{cid}",
                        "ad_format_type": r.choice(["TEXT", "IMAGE", "VIDEO"]),
                        "region_code": region,
                        "first_shown": first.isoformat(),
                        "last_shown": min(last, day_date(day)).isoformat(),
                        "times_shown_lower_bound": low,
                        "times_shown_upper_bound": low * 10 if low else 1_000,
                    }
                )
    return rows


def reset_ads_caches() -> None:
    meta_pages.cache_clear()
    _meta_state.cache_clear()
    _meta_index.cache_clear()
    tiktok_advertisers.cache_clear()
    _tiktok_state.cache_clear()
    google_advertisers.cache_clear()
