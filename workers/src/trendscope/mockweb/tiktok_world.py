"""TikTok Shop, creators, video's en livestreams op het nep-internet (partner-API, YouTube, Instagram).

Alles is een functie van (entiteit, dag): tellers (verkocht, volgers, views) groeien per archetype, zodat dagelijkse
crawls realistische verschillen zien. Dag 0 = de seed; de simulatie loopt daarna.
"""

from __future__ import annotations

import math
import random
import zlib
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from trendscope.mockweb.baseline import load_baseline
from trendscope.seed import catalog as C

GROWTH = {
    "emerging": 0.14,
    "rising": 0.06,
    "scaling": 0.07,
    "peak": 0.0,
    "saturated": -0.01,
    "declining": -0.05,
    "new": 0.18,
    "ad_peak": 0.02,
    "ads_only": 0.0,
    "noise": 0.0,
}
SHOP_WORDS = ["Official", "Store", "Shop", "Home", "Beauty", "Life", "Lab", "Co"]
EXTRA_CREATORS = [
    "dealsbyemma",
    "kitchenqueen.nl",
    "lifehackluuk",
    "glowupgirlz",
    "budgetfindsbe",
    "petparentpro",
    "fitfam.sara",
    "unboxwithmo",
    "cozyhomeanna",
    "skinbyzoe",
    "dadgadgets",
    "travelwithtess",
    "mamavanvier",
    "techtokker",
    "cleanwithkim",
    "outdoorolly",
    "snackreviewsnl",
    "beautybymaud",
    "gymrat.daan",
    "babyproofhome",
]
COUNTRIES = ["NL", "NL", "DE", "GB", "US", "BE"]


def _crc(*parts: object) -> int:
    return zlib.crc32(":".join(map(str, parts)).encode())


@dataclass(frozen=True)
class ShopProduct:
    external_id: str
    shop_id: str
    cluster_key: int  # seed-cluster-id
    title: str
    price: float
    commission: float
    base_sold: int
    daily: float  # verkopen per dag op dag 0
    growth: float
    image_seed: str


@dataclass(frozen=True)
class Shop:
    external_id: str
    name: str
    country: str
    rating: float
    followers: int
    products: tuple[ShopProduct, ...]


@dataclass(frozen=True)
class Creator:
    handle: str
    name: str
    country: str
    niche: str
    followers0: int
    growth: float
    engagement: float
    business_email: str | None  # alleen als publiek zakelijk gepubliceerd
    lives: bool


@lru_cache(maxsize=1)
def shops() -> tuple[Shop, ...]:
    clusters = load_baseline().clusters
    out = []
    for i in range(32):
        r = random.Random(f"tts:{i}")
        sid = f"7{_crc('shop', i) % 10**15:015d}"
        name = r.choice(C.NAME_HEADS).title() + r.choice(C.NAME_TAILS).lower() + " " + r.choice(SHOP_WORDS)
        products = []
        for k, c in enumerate(r.sample(clusters, r.randint(3, 6))):
            arch = c["arch"]
            products.append(
                ShopProduct(
                    external_id=f"17{_crc('ttp', i, c['id']) % 10**16:016d}",
                    shop_id=sid,
                    cluster_key=int(c["id"]),
                    title=f"{c['title']} {r.choice(['', '– TikTok Viral', '2026', 'Set', 'Original'])}".strip(),
                    price=round(float(c["price"]) * r.uniform(0.6, 0.95), 2),
                    commission=round(r.uniform(0.08, 0.25), 2),
                    base_sold=int(r.lognormvariate(7, 1.3)),
                    daily=max(0.5, r.lognormvariate(2.2, 1.0) * (2.5 if arch in ("emerging", "new") else 1)),
                    growth=GROWTH.get(arch, 0.0) * r.uniform(0.7, 1.3),
                    image_seed=c["title"],
                )
            )
            _ = k
        out.append(
            Shop(
                sid,
                name,
                r.choice(COUNTRIES),
                round(r.uniform(4.3, 4.9), 1),
                int(r.lognormvariate(9, 1.4)),
                tuple(products),
            )
        )
    return tuple(out)


@lru_cache(maxsize=1)
def products_by_id() -> dict[str, ShopProduct]:
    return {p.external_id: p for s in shops() for p in s.products}


def sold_on(p: ShopProduct, day: int) -> int:
    """Cumulatieve teller op de productpagina."""
    total = p.base_sold
    for d in range(1, day + 1):
        noise = 1 + 0.25 * math.sin(_crc(p.external_id) % 11 + d * 1.7)
        total += int(p.daily * math.exp(p.growth * d) * noise)
    return total


@lru_cache(maxsize=1)
def creators() -> tuple[Creator, ...]:
    niches = list(C.PRODUCTS)
    out = []
    for i, handle in enumerate(list(C.CREATOR_HANDLES) + EXTRA_CREATORS):
        r = random.Random(f"cr:{handle}")
        f0 = int(r.lognormvariate(11.2, 1.1))
        out.append(
            Creator(
                handle=handle,
                name=handle.replace(".", " ").replace("_", " ").title(),
                country=r.choice(COUNTRIES),
                niche=niches[_crc(handle) % len(niches)],
                followers0=f0,
                growth=r.choice([0.0, 0.002, 0.005, 0.012, 0.03]),
                engagement=round(r.uniform(0.02, 0.11), 3),
                business_email=f"collab@{handle.split('.')[0]}.example" if r.random() < 0.4 else None,
                lives=i % 4 == 0,
            )
        )
    return tuple(out)


@lru_cache(maxsize=1)
def creators_by_handle() -> dict[str, Creator]:
    return {c.handle: c for c in creators()}


def followers_on(c: Creator, day: int) -> int:
    return int(c.followers0 * math.exp(c.growth * day))


def _niche_products(c: Creator) -> list[ShopProduct]:
    clusters = {int(x["id"]): x for x in load_baseline().clusters}
    same = [p for p in products_by_id().values() if clusters.get(p.cluster_key, {}).get("niche") == c.niche]
    return same or list(products_by_id().values())


def videos_until(c: Creator, day: int) -> list[dict[str, Any]]:
    """Video's die op `day` bestaan (recentste 20), met hun tellerstanden op die dag."""
    out: list[dict[str, Any]] = []
    candidates = _niche_products(c)
    for posted in range(day - 40, day + 1):
        if _crc(c.handle, "post", posted) % 3:  # ongeveer elke 3 dagen een video
            continue
        r = random.Random(f"v:{c.handle}:{posted}")
        product = r.choice(candidates) if r.random() < 0.75 else None
        title = product.title.split(" –")[0] if product else r.choice(["morning routine", "haul", "day in my life"])
        potential = (
            followers_on(c, posted) * r.uniform(0.15, 4.0) * (1 + 3 * max(0.0, product.growth if product else 0) * 10)
        )
        age = day - posted
        views = int(potential * (1 - math.exp(-(age + 0.5) / 2.2)))
        views_prev = int(potential * (1 - math.exp(-(age - 0.5) / 2.2))) if age > 0 else 0
        hook = r.choice(C.HOOKS).format(p=title.split()[-1].lower())
        tag = "".join(ch for ch in title.lower() if ch.isalnum())[:30]
        out.append(
            {
                "id": f"73{_crc(c.handle, posted) % 10**17:017d}",
                "posted_day": posted,
                "caption": f"{hook} #{tag} #tiktokmademebuyit #{c.niche.replace('-', '')}",
                "views": views,
                "views_24h": views - views_prev,
                "likes": int(views * c.engagement * 0.8),
                "comments": int(views * c.engagement * 0.05),
                "shares": int(views * c.engagement * 0.08),
                "product_id": product.external_id if product else None,
                "cover_seed": title,
            }
        )
    return sorted(out, key=lambda v: -int(v["posted_day"]))[:20]


def lives_until(c: Creator, day: int) -> list[dict[str, Any]]:
    if not c.lives:
        return []
    out = []
    candidates = _niche_products(c)
    for d in range(day - 14, day + 1):
        if _crc(c.handle, "live", d) % 5:
            continue
        r = random.Random(f"l:{c.handle}:{d}")
        prods = r.sample(candidates, min(len(candidates), r.randint(2, 5)))
        viewers = int(followers_on(c, d) * r.uniform(0.01, 0.06))
        out.append(
            {
                "id": f"72{_crc(c.handle, 'live', d) % 10**17:017d}",
                "day": d,
                "hour": 18 + r.randint(0, 3),
                "title": f"{r.choice(['Flash sale', 'Unboxing live', 'Q&A + deals', 'Live shopping'])} 🔴",
                "duration_min": r.randint(45, 180),
                "peak_viewers": int(viewers * r.uniform(0.15, 0.35)),
                "total_viewers": viewers,
                "products": [
                    {"product_id": p.external_id, "units": int(viewers * r.uniform(0.002, 0.02))} for p in prods
                ],
            }
        )
    return out


def top_products(niche: str, day: int, limit: int = 30) -> list[tuple[Shop, ShopProduct]]:
    clusters = {int(x["id"]): x for x in load_baseline().clusters}
    hits = [(s, p) for s in shops() for p in s.products if clusters.get(p.cluster_key, {}).get("niche") == niche]
    return sorted(hits, key=lambda sp: -(sold_on(sp[1], day) - sold_on(sp[1], max(0, day - 7))))[:limit]


def top_creators(niche: str, limit: int = 15) -> list[Creator]:
    return sorted([c for c in creators() if c.niche == niche], key=lambda c: -c.followers0)[:limit]


def reset_tiktok_caches() -> None:
    shops.cache_clear()
    products_by_id.cache_clear()
    creators.cache_clear()
    creators_by_handle.cache_clear()
