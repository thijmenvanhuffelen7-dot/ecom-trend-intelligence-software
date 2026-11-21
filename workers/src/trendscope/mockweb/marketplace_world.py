"""Marktplaatsen op het nep-internet: AliExpress-, CJ- en Amazon-listings per product, dag na dag."""

from __future__ import annotations

import math
import random
import re
import zlib
from dataclasses import dataclass
from functools import lru_cache

from trendscope.mockweb.baseline import load_baseline

# Producten die (nog) alleen op marktplaatsen bestaan → de clustering moet er zelf clusters van maken
MARKET_ONLY = [
    ("Electric Scalp Massager", 6.2, 29.0, "beauty-tools", "emerging"),
    ("Magnetic Phone Ring Holder", 1.1, 12.0, "tech-gadgets", "rising"),
    ("Portable Neck Heater", 7.4, 34.0, "fitness", "emerging"),
    ("Silicone Ice Cube Tray", 1.6, 14.0, "home-kitchen", "peak"),
    ("Smart Water Bottle Reminder", 8.8, 39.0, "outdoor", "rising"),
    ("Wireless Car Vacuum Cleaner", 11.5, 49.0, "tech-gadgets", "emerging"),
    ("Heated Eye Massager", 9.9, 45.0, "beauty-tools", "rising"),
    ("Collapsible Laundry Basket", 3.4, 22.0, "home-decor", "saturated"),
]
PREFIXES = ["2026 New", "Hot Sale", "Upgraded", "", "Original", "Mini"]
SUFFIXES = [
    "for Women Men",
    "Rechargeable",
    "Portable",
    "Gift Idea",
    "Home Travel",
    "Durable",
    "Multifunctional",
    "1/2/3 Pcs",
    "High Quality",
    "Fast Shipping",
]
GROWTH = {
    "emerging": 0.16,
    "rising": 0.06,
    "peak": 0.0,
    "saturated": -0.01,
    "declining": -0.05,
    "noise": 0.0,
    "ads_only": 0.0,
}


@dataclass(frozen=True)
class MarketItem:
    key: str
    title: str
    cost: float
    retail: float
    niche: str
    arch: str


@dataclass(frozen=True)
class Offer:
    source: str
    external_id: str
    item: MarketItem
    variant: int
    title: str
    base_price: float
    base_orders: int
    seller_id: str
    seller_name: str
    image_url: str
    shipping: tuple[float, int, int] | None = None  # kosten, min dagen, max dagen
    rating: float = 4.6


def _crc(*parts: object) -> int:
    return zlib.crc32(":".join(map(str, parts)).encode())


def _core(title: str) -> str:
    """Titel zonder varianten-woorden ('Pro', 'Set', ...): zo zoek je op een marktplaats."""
    return re.sub(r"\s+(Pro|Set|Mini|Kit|2\.0)\b", "", title).strip()


@lru_cache(maxsize=1)
def items() -> tuple[MarketItem, ...]:
    out = [
        MarketItem(f"c{c['id']}", c["title"], float(c["cost"]), float(c["price"]), c["niche"], c["arch"])
        for c in load_baseline().clusters
    ]
    out += [
        MarketItem(f"m{i}", t, cost, retail, niche, arch)
        for i, (t, cost, retail, niche, arch) in enumerate(MARKET_ONLY)
    ]
    return tuple(out)


@lru_cache(maxsize=1)
def offers() -> tuple[Offer, ...]:
    out: list[Offer] = []
    for it in items():
        r = random.Random(f"offers:{it.key}")
        core = _core(it.title)
        for k in range(r.randint(3, 5)):
            title = " ".join(x for x in [r.choice(PREFIXES), core, *r.sample(SUFFIXES, 2)] if x)
            eid = f"1005{_crc('ae', it.key, k) % 10**9:09d}"
            out.append(
                Offer(
                    "aliexpress",
                    eid,
                    it,
                    k,
                    title,
                    round(it.cost * r.uniform(0.85, 1.3), 2),
                    r.randint(40, 2500),
                    f"91{_crc('shop', it.key, k) % 10**7:07d}",
                    f"{r.choice(['Shenzhen', 'Yiwu', 'Guangzhou', 'Ningbo'])} {r.choice(['Best', 'Global', 'Happy', 'Smart'])} Store",
                    f"https://ae-pic-a1.aliexpress-media.com/kf/{eid}.png",
                    None,
                    round(r.uniform(4.3, 4.9), 1),
                )
            )
        for k in range(r.randint(1, 2)):
            pid = f"{_crc('cj', it.key, k) % 16**8:08X}-CJ{k}"
            out.append(
                Offer(
                    "cj",
                    pid,
                    it,
                    10 + k,
                    f"{core} {r.choice(['', 'Set', 'Kit', 'New'])}".strip(),
                    round(it.cost * r.uniform(1.0, 1.25), 2),
                    0,
                    "cj",
                    "CJ Dropshipping",
                    f"https://cf.cjdropshipping.com/{pid}.png",
                    (round(r.uniform(2.2, 6.5), 2), r.randint(5, 8), r.randint(9, 15)),
                )
            )
        if it.retail >= 15:
            for k in range(r.randint(1, 2)):
                asin = f"B0{_crc('az', it.key, k) % 36**8:08d}"[:10].upper()
                brand = r.choice(["Lumenix", "Vivora", "Homely", "Kinsa", "Orvo"])
                out.append(
                    Offer(
                        "amazon",
                        asin,
                        it,
                        20 + k,
                        f"{brand} {core} – {r.choice(SUFFIXES)}",
                        round(it.retail * r.uniform(0.95, 1.25), 2),
                        r.randint(800, 60_000),
                        brand,
                        brand,
                        f"https://m.media-amazon.com/images/I/{asin}.png",
                        None,
                        round(r.uniform(3.9, 4.7), 1),
                    )
                )
    return tuple(out)


@lru_cache(maxsize=1)
def offers_by_id() -> dict[str, Offer]:
    return {o.external_id: o for o in offers()}


def orders_on(o: Offer, day: int) -> int:
    g = GROWTH.get(o.item.arch, 0.0)
    noise = 1 + 0.08 * math.sin(_crc(o.external_id) % 7 + day)
    return max(0, int(o.base_orders * math.exp(g * day) * noise))


def price_on(o: Offer, day: int) -> float:
    # af en toe een prijsaanpassing (vaste dagen per listing)
    steps = sum(1 for d in range(1, day + 1) if _crc(o.external_id, "price", d) % 23 == 0)
    return round(o.base_price * (0.95**steps), 2)


def rank_on(o: Offer, day: int) -> int:
    """Amazon BSR daalt (= beter) naarmate de vraag stijgt."""
    return max(1, int(400_000 / math.sqrt(max(orders_on(o, day), 1))))


def search(source: str, term: str) -> list[Offer]:
    words = term.lower().split()
    hits = [o for o in offers() if o.source == source and all(w in o.title.lower() for w in words)]
    return sorted(hits, key=lambda o: -o.base_orders)


def reset_marketplace_caches() -> None:
    items.cache_clear()
    offers.cache_clear()
    offers_by_id.cache_clear()
