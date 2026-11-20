"""Bereik- en spendschattingen per ad. Altijd met bandbreedte, betrouwbaarheid en methode (UI toont dat)."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

from trendscope.ads.records import AdRecord

# CPM-bandbreedtes (EUR per 1.000 vertoningen) per landengroep; bron: publieke benchmarks, grof
CPM_EUR: dict[str, tuple[float, float]] = {
    "tier1": (6.0, 14.0),  # US, GB, CA, AU, DE, NL, SE, DK, NO, CH
    "tier2": (3.5, 9.0),  # overige EU
    "other": (1.5, 5.0),
}
TIER1 = {"US", "GB", "CA", "AU", "DE", "NL", "SE", "DK", "NO", "CH", "AT", "BE", "FI", "IE"}
FREQUENCY = (1.4, 2.6)  # vertoningen per bereikte persoon


def _tier(countries: list[str]) -> str:
    if not countries:
        return "other"
    return "tier1" if sum(c in TIER1 for c in countries) >= len(countries) / 2 else "tier2"


def _estimate(
    value: float, low: float, high: float, confidence: str, method: str, currency: str | None = None
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "value": round(value),
        "low": round(low),
        "high": round(high),
        "confidence": confidence,
        "method": method,
    }
    if currency:
        out["currency"] = currency
    return out


def estimate_reach(ad: AdRecord, variants: int, today: date) -> dict[str, Any] | None:
    """Exact bij EU-transparantiedata; anders een heuristiek op looptijd, varianten en landen."""
    if ad.eu_reach is not None:
        return _estimate(ad.eu_reach, ad.eu_reach, ad.eu_reach, "high", "Meta EU-transparantie (eu_total_reach)")
    if ad.impressions_low is not None or ad.impressions_high is not None:
        lo = (ad.impressions_low or 0) / FREQUENCY[1]
        hi = (ad.impressions_high or ad.impressions_low or 0) / FREQUENCY[0]
        source = "TikTok bereikbandbreedte" if ad.platform == "tiktok" else "Google times_shown ÷ frequentie"
        return _estimate(math.sqrt(max(lo, 1) * max(hi, 1)), lo, hi, "medium", source)
    if not ad.start_date:
        return None
    days = max(1, ((ad.end_date or today) - ad.start_date).days)
    # Heuristiek: een ad die blijft draaien, verdient zijn budget terug; meer varianten en landen = meer budget
    base = 400 * days**0.85 * (1 + 0.35 * (variants - 1)) * (1 + 0.25 * (max(1, len(ad.countries)) - 1))
    return _estimate(base, base * 0.4, base * 2.5, "low", "heuristiek: looptijd × varianten × landen")


def estimate_spend(reach: dict[str, Any] | None, countries: list[str]) -> dict[str, Any] | None:
    if not reach:
        return None
    cpm_lo, cpm_hi = CPM_EUR[_tier(countries)]
    lo = reach["low"] * FREQUENCY[0] * cpm_lo / 1000
    hi = reach["high"] * FREQUENCY[1] * cpm_hi / 1000
    confidence = "medium" if reach["confidence"] == "high" else "low"
    return _estimate(
        math.sqrt(max(lo, 1) * max(hi, 1)), lo, hi, confidence, f"bereik × frequentie × CPM ({_tier(countries)})", "EUR"
    )
