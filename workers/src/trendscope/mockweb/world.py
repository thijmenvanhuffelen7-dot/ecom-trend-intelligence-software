"""Deterministisch nep-internet: winkels die dag na dag veranderen.

De staat op dag *d* is altijd dezelfde, ongeacht hoe vaak of in welke volgorde je hem opvraagt:
elke dag past een eigen `Random(f"{domein}:{dag}")` wijzigingen toe op de staat van de dag ervoor.
Zo draait in mock-modus de échte crawl-pipeline (HTTP → parse → diff → opslag) reproduceerbaar.
"""

from __future__ import annotations

import copy
import random
from datetime import UTC, datetime, time, timedelta
from functools import lru_cache
from typing import Any
from urllib.parse import quote

from trendscope.mockweb.baseline import StoreBaseline, load_baseline
from trendscope.seed import catalog as C

# Kans per dag op een nieuw product, per winkeltype
NEW_PRODUCT_RATE = {"scaling": 0.55, "new": 0.6, "ad_peak": 0.45, "stable": 0.2, "declining": 0.06}
REMOVE_RATE = {"scaling": 0.006, "new": 0.004, "ad_peak": 0.008, "stable": 0.01, "declining": 0.03}
PRICE_CHANGE_RATE = 0.02
STOCK_TOGGLE_RATE = 0.012


def _media(**params: Any) -> str:
    return "/media/demo/product.svg?" + "&".join(f"{k}={quote(str(v))}" for k, v in params.items())


def _slug(text: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-").replace("--", "-")


def day_timestamp(day: int, hour: int = 9) -> datetime:
    return datetime.combine(load_baseline().day0 + timedelta(days=day), time(hour), tzinfo=UTC)


def _new_product(store: StoreBaseline, day: int, k: int, r: random.Random) -> dict[str, Any]:
    niche = r.choice(store.niches)
    title, emoji, price, _cost, category = r.choice(C.PRODUCTS[niche])
    suffix = r.choice(["", "", " Pro", " 2.0", " — Limited Edition", " Bundle"])
    full = f"{title}{suffix}"
    pid = f"8{int.from_bytes(f'{store.domain}:{day}:{k}'.encode(), 'big') % 10**12:012d}"  # stabiel over runs (geen hash())
    p = round(round(price * r.uniform(0.85, 1.2), 2) - 0.05, 2)
    return {
        "id": pid,
        "handle": f"{_slug(full)}-{pid[-4:]}",
        "title": full,
        "price": p,
        "compare_at_price": round(p * 1.6, 2) if r.random() < 0.6 else None,
        "variants": [
            {"id": f"{pid}{i}", "title": t, "price": p, "available": True} for i, t in enumerate(["Default Title"])
        ],
        "published_at": day_timestamp(day, 8).isoformat(),
        "image": _media(e=emoji, h=r.randint(0, 359)),
        "best_seller_rank": None,
        "product_type": category,
        "vendor": store.name,
        "tags": [niche, "new"],
    }


@lru_cache(maxsize=4096)
def _catalog(domain: str, day: int) -> tuple[dict[str, Any], ...]:
    store = sites()[domain]
    if day <= store.launch_day:
        products = [copy.deepcopy(p) for p in store.products]
        return tuple(products)
    products = [copy.deepcopy(p) for p in _catalog(domain, day - 1)]
    r = random.Random(f"{domain}:{day}")
    arch = store.arch if store.arch in NEW_PRODUCT_RATE else "stable"

    # verwijderde producten
    products = [p for p in products if r.random() >= REMOVE_RATE[arch]]
    # prijs- en voorraadwijzigingen
    for p in products:
        if r.random() < PRICE_CHANGE_RATE:
            factor = r.choice([0.8, 0.85, 0.9, 1.1, 1.15])
            p["price"] = round(p["price"] * factor, 2)
            for v in p["variants"]:
                v["price"] = p["price"]
        for v in p["variants"]:
            if r.random() < STOCK_TOGGLE_RATE:
                v["available"] = not v["available"]
    # nieuwe producten; een deel schiet direct de bestsellers in
    n_new = int(r.random() < NEW_PRODUCT_RATE[arch]) + int(r.random() < NEW_PRODUCT_RATE[arch] / 3)
    for k in range(n_new):
        p = _new_product(store, day, k, r)
        if r.random() < 0.35:
            for q in products:
                if q["best_seller_rank"]:
                    q["best_seller_rank"] += 1
            p["best_seller_rank"] = 1
        products.append(p)
    for q in products:
        if q["best_seller_rank"] and q["best_seller_rank"] > 10:
            q["best_seller_rank"] = None
    return tuple(products)


def catalog(domain: str, day: int) -> list[dict[str, Any]]:
    return list(_catalog(domain, max(0, day)))


def current_day() -> int:
    from trendscope.core.settings import get_settings

    override = get_settings().mock_web_day
    if override is not None:
        return override
    return (datetime.now(UTC).date() - load_baseline().day0).days


# ── Winkels die nog niet in de database staan (voor discovery) ─────────────
UNDISCOVERED_PLATFORMS = ["shopify"] * 14 + ["woocommerce"] * 3 + ["magento", "bigcommerce", "wix", "none", "none"]
DISCOVERY_SUFFIXES = ["shop", "store", "beauty", "skin", "pets", "home", "fit", "baby", "wear"]


@lru_cache(maxsize=1)
def undiscovered() -> tuple[StoreBaseline, ...]:
    r = random.Random(7)
    base = load_baseline()
    taken = {s.domain.split(".")[0] for s in base.stores}
    out: list[StoreBaseline] = []
    for i, platform in enumerate(UNDISCOVERED_PLATFORMS):
        while True:
            name = (r.choice(C.NAME_HEADS) + r.choice(DISCOVERY_SUFFIXES)).capitalize()
            if name.lower() not in taken:
                taken.add(name.lower())
                break
        country = r.choice(["NL", "BE", "DE", "US", "GB"])
        niches = [r.choice(list(C.PRODUCTS))]
        store = StoreBaseline(
            domain=f"{name.lower()}.com",
            name=name,
            country=country,
            currency=C.CURRENCY[country],
            language=C.LANGUAGE[country],
            theme=r.choice(C.THEMES),
            arch=r.choice(["new", "scaling"]),
            color=f"hsl({r.randint(0, 359)} 55% 38%)",
            niches=niches,
            technologies=r.sample(C.TECH["pixel"], 3)
            + r.sample([a for a in C.TECH["app"] if a != "Afterpay"], 3)
            + r.sample(C.TECH["payment"], 2),
            social={"instagram": name.lower()},
            products=[],
            platform=platform,
            launch_day=1 + i % 13,
        )
        # Startcatalogus op de lanceringsdag
        store.products = [_new_product(store, store.launch_day, k, r) for k in range(r.randint(4, 12))]
        for rank, p in enumerate(store.products[:5], start=1):
            p["best_seller_rank"] = rank
        out.append(store)
    return tuple(out)


@lru_cache(maxsize=1)
def sites() -> dict[str, StoreBaseline]:
    """Alle websites op het nep-internet: bekende demowinkels + nog te ontdekken sites."""
    return {s.domain: s for s in [*load_baseline().stores, *undiscovered()]}


def reset_caches() -> None:
    _catalog.cache_clear()
    undiscovered.cache_clear()
    sites.cache_clear()
    load_baseline.cache_clear()
