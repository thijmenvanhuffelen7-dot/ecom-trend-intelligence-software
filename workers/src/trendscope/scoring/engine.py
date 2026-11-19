"""Scoring-engine: groeisnelheid, validatie, saturatie, opportuniteit en trendfase.

Pure functies zonder I/O, zodat dezelfde code dagelijks draait én historisch kan worden
afgespeeld voor backtests. Elke score levert een uitleg (`breakdown`) die de UI toont.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Signal(StrEnum):
    store = "store"
    ads = "ads"
    social = "social"
    tiktokshop = "tiktokshop"
    marketplace = "marketplace"
    search = "search"
    reddit = "reddit"
    price = "price"


# Gecorreleerde bronnen zitten in dezelfde groep en tellen niet als onafhankelijk bewijs.
SIGNAL_GROUPS: dict[Signal, str] = {
    Signal.store: "supply",
    Signal.ads: "supply",
    Signal.search: "demand",
    Signal.reddit: "demand",
    Signal.social: "demand",
    Signal.tiktokshop: "transactions",
    Signal.marketplace: "transactions",
    Signal.price: "economics",
}

GROWTH_SIGNALS = [s for s in Signal if s is not Signal.price]
DEMAND_SIGNALS = [Signal.search, Signal.reddit, Signal.social, Signal.tiktokshop, Signal.marketplace]

DEFAULT_WEIGHTS: dict[str, float] = {
    "store": 1.0,
    "ads": 1.2,
    "social": 1.0,
    "tiktokshop": 1.1,
    "marketplace": 0.9,
    "search": 1.0,
    "reddit": 0.6,
    "price": 0.8,
}


@dataclass(frozen=True)
class Params:
    smoothing_k: float = 3.0  # vermijdt explosieve groei bij kleine aantallen
    window_mix: tuple[float, float, float] = (0.2, 0.5, 0.3)  # gewicht van 1/7/30 dagen
    positive_growth: float = 0.05  # log-groei (~ +5%) waarboven een signaal "positief" is
    min_positive_signals: int = 3
    gate_cap: float = 40.0  # max validatie bij te weinig onafhankelijk bewijs
    convergence_bonus: float = 0.05  # per extra positieve groep boven de eerste
    min_category_size: int = 20  # kleinere categorieën normaliseren tegen de hele populatie
    growth_scale: float = 0.6  # log-groei waarbij de absolute sterkte ~76% is (tanh)
    concentration_share: float = 0.6
    concentration_penalty: float = 0.7
    saturation_midpoint: float = math.log1p(60)  # ~60 winkels + adverteerders
    saturation_slope: float = 1.1
    saturation_demand_relief: float = 2.5
    healthy_margin: float = 0.5


@dataclass
class EntityInput:
    entity_id: int
    series: Mapping[Signal, Sequence[float]]  # dagwaarden, oudste eerst, laatste = vandaag
    store_count: int = 0
    advertiser_count: int = 0
    margin: float | None = None  # (verkoop - inkoop - verzending) / verkoop
    category: str = "all"
    reliability: Mapping[Signal, float] = field(default_factory=dict)


@dataclass
class SignalBreakdown:
    signal: str
    group: str
    latest: float
    growth_1d: float
    growth_7d: float
    growth_30d: float
    growth: float
    normalized: float
    weight: float
    contribution: float
    share: float
    positive: bool
    reliability: float


@dataclass
class ScoreResult:
    entity_id: int
    growth_velocity: float  # gewogen groei als percentage, bv. 42.0 = +42%
    validation: float  # 0–100
    saturation: float  # 0–1
    opportunity: float  # 0–100
    phase: str
    breakdown: dict[str, Any]


def log_growth(series: Sequence[float], window: int, k: float) -> float:
    """log((gem. laatste w dagen + k) / (gem. w dagen daarvoor + k)); robuust bij ruis en nullen."""
    if len(series) < 2:
        return 0.0
    w = max(1, min(window, len(series) // 2))
    recent = series[-w:]
    previous = series[-2 * w : -w]
    if not previous:
        return 0.0
    return math.log((sum(recent) / len(recent) + k) / (sum(previous) / len(previous) + k))


def percentile_ranks(values: Sequence[float]) -> list[float]:
    """Percentielrang (0–1) per waarde; gelijke waarden krijgen dezelfde (gemiddelde) rang."""
    n = len(values)
    if n == 0:
        return []
    if n == 1:
        return [0.5]
    order = sorted(range(n), key=lambda i: values[i])
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and values[order[j + 1]] == values[order[i]]:
            j += 1
        rank = (i + j) / 2 / (n - 1)
        for m in range(i, j + 1):
            ranks[order[m]] = rank
        i = j + 1
    return ranks


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def classify_phase(demand_g7: float, demand_g30: float, saturation: float) -> str:
    """Fase op basis van niveau én versnelling van de vraag, plus saturatie van het aanbod."""
    if demand_g7 < -0.05 and demand_g30 < 0.05:
        return "declining"
    accelerating = demand_g7 > 0.08 and demand_g7 > 0.45 * demand_g30
    if accelerating and saturation < 0.4:
        return "emerging"
    if demand_g30 > 0.1 and demand_g7 > 0.02:
        return "rising"
    if demand_g30 > 0.15:
        return "peak"  # flink gegroeid, maar de groei stokt
    return "saturated"  # vlakke vraag: volwassen markt


def score_population(
    entities: Sequence[EntityInput],
    weights: Mapping[str, float] | None = None,
    params: Params | None = None,
) -> list[ScoreResult]:
    """Scoort een populatie. Normalisatie gebeurt per categorie, zodat grote niches niet domineren."""
    weights = dict(DEFAULT_WEIGHTS | dict(weights or {}))
    p = params or Params()
    w1, w7, w30 = p.window_mix

    # 1. Ruwe groei per entiteit per signaal
    growth: list[dict[Signal, tuple[float, float, float, float]]] = []
    for e in entities:
        g: dict[Signal, tuple[float, float, float, float]] = {}
        for sig in GROWTH_SIGNALS:
            series = e.series.get(sig)
            if not series or len(series) < 2:
                continue
            g1 = log_growth(series, 1, p.smoothing_k)
            g7 = log_growth(series, 7, p.smoothing_k)
            g30 = log_growth(series, 30, p.smoothing_k)
            g[sig] = (g1, g7, g30, w1 * g1 + w7 * g7 + w30 * g30)
        growth.append(g)

    # 2. Percentiel per signaal binnen de categorie
    normalized: list[dict[Signal, float]] = [{} for _ in entities]
    by_category: dict[str, list[int]] = {}
    for idx, e in enumerate(entities):
        by_category.setdefault(e.category, []).append(idx)
    small = [i for key, members in by_category.items() if len(members) < p.min_category_size for i in members]
    by_category = {k: v for k, v in by_category.items() if len(v) >= p.min_category_size}
    if small:
        by_category["__pooled__"] = small
    for members in by_category.values():
        for sig in GROWTH_SIGNALS:
            idxs = [i for i in members if sig in growth[i]]
            ranks = percentile_ranks([growth[i][sig][3] for i in idxs])
            for i, rank in zip(idxs, ranks, strict=True):
                normalized[i][sig] = rank

    results: list[ScoreResult] = []
    for idx, e in enumerate(entities):
        rows: list[SignalBreakdown] = []
        for signal, (g1, g7, g30, gc) in growth[idx].items():
            rel = float(e.reliability.get(signal, 1.0))
            rows.append(
                SignalBreakdown(
                    signal=signal.value,
                    group=SIGNAL_GROUPS[signal],
                    latest=float(e.series[signal][-1]),
                    growth_1d=_pct(g1),
                    growth_7d=_pct(g7),
                    growth_30d=_pct(g30),
                    growth=gc,
                    # relatieve positie (percentiel) én absolute sterkte: top van een stilstaande markt scoort niet 100
                    normalized=0.5 * normalized[idx][signal] + 0.5 * max(0.0, math.tanh(gc / p.growth_scale)),
                    weight=weights[signal.value] * rel,
                    contribution=0.0,
                    share=0.0,
                    positive=gc > p.positive_growth,
                    reliability=rel,
                )
            )

        margin_score = None
        if e.margin is not None:
            margin_score = max(0.0, min(1.0, e.margin / (2 * p.healthy_margin)))
            rows.append(
                SignalBreakdown(
                    signal=Signal.price.value,
                    group=SIGNAL_GROUPS[Signal.price],
                    latest=e.margin,
                    growth_1d=0.0,
                    growth_7d=0.0,
                    growth_30d=0.0,
                    growth=0.0,
                    normalized=margin_score,
                    weight=weights[Signal.price.value],
                    contribution=0.0,
                    share=0.0,
                    positive=e.margin >= p.healthy_margin * 0.8,
                    reliability=1.0,
                )
            )

        total_weight = sum(r.weight for r in rows) or 1.0
        for r in rows:
            r.contribution = r.weight * r.normalized * (1.0 if r.positive else 0.25) / total_weight * 100
        total_contrib = sum(r.contribution for r in rows) or 1.0
        for r in rows:
            r.share = r.contribution / total_contrib

        growth_rows = [r for r in rows if r.signal != Signal.price.value]
        gw = sum(r.weight for r in growth_rows) or 1.0
        velocity = _pct(sum(r.weight * r.growth for r in growth_rows) / gw) if growth_rows else 0.0

        positives = [r for r in rows if r.positive]
        positive_groups = sorted({r.group for r in positives})
        notes: list[str] = []
        validation = sum(r.contribution for r in rows)
        if len(positive_groups) >= 2:
            validation *= 1 + p.convergence_bonus * (len(positive_groups) - 1)
            notes.append("convergence_bonus")
        top_share = max((r.share for r in rows), default=0.0)
        if top_share > p.concentration_share:
            validation *= p.concentration_penalty
            notes.append("concentration_penalty")
        if len(positives) < p.min_positive_signals:
            validation = min(validation, p.gate_cap)
            notes.append("gate_min_signals")
        validation = max(0.0, min(100.0, validation))

        demand = [growth[idx][s] for s in DEMAND_SIGNALS if s in growth[idx]]
        demand_g7 = sum(d[1] for d in demand) / len(demand) if demand else 0.0
        demand_g30 = sum(d[2] for d in demand) / len(demand) if demand else 0.0
        demand_growth = sum(d[3] for d in demand) / len(demand) if demand else 0.0
        supply = e.store_count + e.advertiser_count
        saturation = _sigmoid(
            p.saturation_slope * (math.log1p(supply) - p.saturation_midpoint)
            - p.saturation_demand_relief * demand_growth
        )

        margin_factor = 0.4 + 0.8 * margin_score if margin_score is not None else 0.8
        opportunity = max(0.0, min(100.0, validation * (1 - saturation) * margin_factor))
        phase = classify_phase(demand_g7, demand_g30, saturation)

        rows.sort(key=lambda r: r.contribution, reverse=True)
        results.append(
            ScoreResult(
                entity_id=e.entity_id,
                growth_velocity=round(velocity, 1),
                validation=round(validation, 1),
                saturation=round(saturation, 3),
                opportunity=round(opportunity, 1),
                phase=phase,
                breakdown={
                    "signals": [r.__dict__ | {"growth": round(r.growth, 4)} for r in rows],
                    "positive_signals": len(positives),
                    "positive_groups": positive_groups,
                    "notes": notes,
                    "supply": {"stores": e.store_count, "advertisers": e.advertiser_count},
                    "demand_growth_7d": _pct(demand_g7),
                    "margin": e.margin,
                    "margin_factor": round(margin_factor, 2),
                },
            )
        )
    return results


def _pct(log_g: float) -> float:
    return round((math.exp(log_g) - 1) * 100, 1)
