"""Zoekinteresse (Google Trends-achtig, index 0–100) en Reddit-posts op het nep-internet.

Elk keyword heeft een vaste vorm (archetype) en eventueel een seizoenspatroon. Waarden zijn deterministisch per
(keyword, land, datum), zodat dezelfde dag altijd hetzelfde antwoord geeft — net als een echte API binnen één venster.
"""

from __future__ import annotations

import math
import re
import zlib
from datetime import date, timedelta
from functools import lru_cache

from trendscope.mockweb.baseline import load_baseline

COUNTRIES = {"NL": 1.0, "DE": 0.9, "GB": 0.8, "US": 0.7}
# Trends beginnen vaak in de VS en bereiken Europa later (dagen voorsprong t.o.v. NL)
LEAD_DAYS = {"US": 21, "GB": 10, "NL": 0, "DE": -12}
LOCATION_NAMES = {"Netherlands": "NL", "Germany": "DE", "United Kingdom": "GB", "United States": "US"}

# Onderwerpen zonder (nog) gekoppeld product: de trendpagina moet ze zelf vinden
TOPICS: list[tuple[str, str, str, int | None]] = [
    # term, niche, archetype, seizoenspiek (maand) of None
    ("mushroom coffee", "food-grocery", "rising", None),
    ("red light therapy", "skincare", "emerging", None),
    ("lymphatic drainage", "natural-health", "emerging", None),
    ("cloud slides", "fashion-accessories", "peak", 7),
    ("weighted blanket", "home-decor", "saturated", 11),
    ("magnetic lashes", "beauty-tools", "declining", None),
    ("sleepy girl mocktail", "food-grocery", "emerging", None),
    ("cortisol cocktail", "food-grocery", "emerging", None),
    ("matcha whisk", "home-kitchen", "rising", None),
    ("heated vest", "outdoor", "saturated", 12),
    ("pool float", "outdoor", "stable", 7),
    ("advent calendar", "home-decor", "stable", 12),
    ("posture corrector", "fitness", "saturated", None),
    ("walking pad", "fitness", "rising", 1),
    ("pet hair remover", "pets", "rising", None),
    ("led strip lights", "home-decor", "declining", None),
]
HASHTAGS = ["tiktokmademebuyit", "amazonfinds", "cleantok", "skincaretok", "kitchenhacks", "giftideas", "homefinds"]
SEASONAL = {
    "neck heater": 12,
    "heated eye massager": 12,
    "ice cube tray": 7,
    "water bottle": 6,
    "sunset projection lamp": 10,
}
SUBREDDITS = {
    "beauty-tools": ["SkincareAddiction", "beauty"],
    "home-kitchen": ["Cooking", "BuyItForLife"],
    "fitness": ["fitness", "homegym"],
    "tech-gadgets": ["gadgets", "BuyItForLife"],
    "pets": ["dogs", "cats"],
    "food-grocery": ["Coffee", "EatCheapAndHealthy"],
    "skincare": ["SkincareAddiction", "30PlusSkinCare"],
    "natural-health": ["Supplements", "naturalremedies"],
    "outdoor": ["CampingGear", "hiking"],
    "home-decor": ["CozyPlaces", "malelivingspace"],
    "fashion-accessories": ["femalefashionadvice", "streetwear"],
    "baby-kids": ["Parenting", "beyondthebump"],
}


def _crc(*parts: object) -> int:
    return zlib.crc32(":".join(map(str, parts)).encode())


def core_term(title: str) -> str:
    """'Brow Lamination Kit Pro' → 'brow lamination' (zoals mensen zoeken)."""
    return re.sub(r"\s+(pro|set|mini|kit|2\.0)\b", "", title.lower()).strip()


@lru_cache(maxsize=1)
def keyword_specs() -> dict[str, tuple[str, str, int | None]]:
    """term → (niche, archetype, seizoenspiek)."""
    out: dict[str, tuple[str, str, int | None]] = {}
    for c in load_baseline().clusters:
        term = core_term(c["title"])
        arch = c["arch"] if c["arch"] not in ("ads_only", "noise") else "stable"
        peak = next((m for key, m in SEASONAL.items() if key in term), None)
        out[term] = (c["niche"], arch, peak)
    for term, niche, arch, peak in TOPICS:
        out[term] = (niche, arch, peak)
    for tag in HASHTAGS:
        out[tag] = ("", "stable", None)
    return out


def _shape(arch: str, x: float) -> float:
    """x = 0 (365 dagen geleden) … 1 (dag 0 + simulatie). Zelfde families als de seed-curves."""
    if arch == "emerging":
        return float(0.06 + 0.94 * max(0.0, x - 0.82) ** 1.5 / 0.18**1.5)
    if arch in ("rising", "scaling"):
        return float(0.2 + 0.8 * max(0.0, x - 0.5) ** 1.3 / 0.5**1.3)
    if arch == "peak":
        return 0.15 + 0.85 * math.exp(-(((x - 0.9) / 0.12) ** 2))
    if arch == "saturated":
        return 0.85 + 0.05 * math.sin(x * 40)
    if arch == "declining":
        return 0.25 + 0.75 * math.exp(-(((x - 0.7) / 0.15) ** 2))
    if arch == "new":
        return 0.02 if x < 0.9 else 0.1 + 0.9 * (x - 0.9) / 0.1
    return 0.5


def raw_interest(term: str, country: str, day: date) -> float:
    """Ongenormaliseerde interesse; de API normaliseert per venster naar max 100."""
    spec = keyword_specs().get(term)
    if spec is None:
        return 0.0
    _, arch, peak = spec
    day0 = load_baseline().day0
    end = day0 + timedelta(days=30)
    lead = LEAD_DAYS.get(country, 0)
    x = 1 - (end - day - timedelta(days=lead)).days / 365  # ouder dan een jaar → x < 0 → beginniveau
    v = _shape(arch, max(0.0, min(1.0, x)))
    if peak:
        # seizoen: cosinus rond de piekmaand, ±35%
        doy = day.timetuple().tm_yday
        peak_doy = (peak - 1) * 30.4 + 15
        v *= 1 + 0.35 * math.cos(2 * math.pi * (doy - peak_doy) / 365.25)
    v *= 1 + 0.07 * math.sin(2 * math.pi * day.weekday() / 7)  # weekritme
    noise = ((_crc(term, country, day.isoformat()) % 1000) / 1000 - 0.5) * 0.12
    return max(0.0, v * (1 + noise) * COUNTRIES.get(country, 0.5))


def interest_window(term: str, country: str, start: date, end: date) -> list[tuple[date, int]]:
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    raw = [raw_interest(term, country, d) for d in days]
    top = max(raw) or 1.0
    return [(d, round(100 * r / top)) for d, r in zip(days, raw, strict=True)]


def reddit_posts(term: str, today: date) -> list[dict[str, object]]:
    """Posts van de laatste 7 dagen die de term noemen; aantal schaalt met de interesse."""
    spec = keyword_specs().get(term)
    if spec is None or not spec[0]:
        return []
    niche = spec[0]
    subs = SUBREDDITS.get(niche, ["BuyItForLife"])
    posts: list[dict[str, object]] = []
    for back in range(7):
        d = today - timedelta(days=back)
        per_day = int(raw_interest(term, "US", d) * 14)
        for k in range(per_day):
            pid = f"{_crc(term, d.isoformat(), k) % 36**6:06x}"
            score = 5 + _crc(pid, "s") % 900
            posts.append(
                {
                    "id": pid,
                    "subreddit": subs[k % len(subs)],
                    "title": f"{['Has anyone tried', 'Honest review:', 'Is the', 'Worth it?'][k % 4]} {term} {['', 'from TikTok', 'hype', 'after a month'][_crc(pid) % 4]}".strip(),
                    "permalink": f"/r/{subs[k % len(subs)]}/comments/{pid}/",
                    "score": score,
                    "num_comments": score // 6,
                    "created_utc": int((d - date(1970, 1, 1)).total_seconds()) + 3600 * (k % 20),
                }
            )
    return posts


def reset_trend_caches() -> None:
    keyword_specs.cache_clear()
