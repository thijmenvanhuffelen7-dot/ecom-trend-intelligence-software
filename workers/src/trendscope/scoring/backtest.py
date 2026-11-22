"""Backtest: scoorden producten die later hard groeiden al vroeg hoog?

Werkwijze per cutoff (bv. 21 dagen geleden):
1. Knip alle reeksen af op de cutoff en scoor de populatie met precies dezelfde engine en gewichten.
2. Uitkomst = groei van de vraag ná de cutoff: log(gem. laatste 7 dagen / gem. 7 dagen vóór de cutoff),
   gemiddeld over de aanwezige vraagsignalen. "Doorbraak" = bovenste kwart van die groei.
3. Metrieken: Spearman-rangcorrelatie (validatie vs. uitkomst), precisie@10 (aandeel doorbraken in de top-10),
   AUC (kans dat een willekeurige doorbraak hoger scoort dan een willekeurige niet-doorbraak) en de basiskans.
Er is geen lek: de score ziet alleen data tot en met de cutoff.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.types.json import Jsonb

from trendscope.scoring.engine import DEMAND_SIGNALS, EntityInput, Signal, score_population
from trendscope.scoring.live import build_inputs, load_series

OUTCOME_WINDOW = 7


def _ranks(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2
        i = j + 1
    return ranks


def spearman(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) < 3:
        return 0.0
    ra, rb = _ranks(a), _ranks(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb, strict=True))
    va = math.sqrt(sum((x - ma) ** 2 for x in ra))
    vb = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return cov / (va * vb) if va and vb else 0.0


def auc(scores: Sequence[float], labels: Sequence[bool]) -> float | None:
    pos = [s for s, lab in zip(scores, labels, strict=True) if lab]
    neg = [s for s, lab in zip(scores, labels, strict=True) if not lab]
    if not pos or not neg:
        return None
    wins = sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def outcome(series: dict[Signal, list[float]], cut: int) -> float | None:
    """Vraaggroei tussen de week vóór index `cut` en de laatste week van de reeks."""
    growths = []
    for sig in DEMAND_SIGNALS:
        s = series.get(sig)
        if not s or len(s) < cut + OUTCOME_WINDOW or cut < OUTCOME_WINDOW:
            continue
        before = sum(s[cut - OUTCOME_WINDOW : cut]) / OUTCOME_WINDOW
        after = sum(s[-OUTCOME_WINDOW:]) / OUTCOME_WINDOW
        growths.append(math.log((after + 3) / (before + 3)))
    return sum(growths) / len(growths) if growths else None


def evaluate(
    inputs: list[EntityInput], horizon: int, weights: dict[str, float]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    truncated, outcomes = [], {}
    for e in inputs:
        n = max((len(v) for v in e.series.values()), default=0)
        cut = n - horizon
        if cut < 21:
            continue
        o = outcome({k: list(v) for k, v in e.series.items()}, cut)
        if o is None:
            continue
        outcomes[e.entity_id] = o
        truncated.append(
            EntityInput(
                entity_id=e.entity_id,
                series={k: list(v)[: len(v) - horizon] for k, v in e.series.items() if len(v) > horizon},
                store_count=e.store_count,
                advertiser_count=e.advertiser_count,
                margin=e.margin,
                category=e.category,
            )
        )
    results = score_population(truncated, weights)
    if len(results) < 8:
        return {"n": len(results)}, []
    vals = [r.validation for r in results]
    opps = [r.opportunity for r in results]
    outs = [outcomes[r.entity_id] for r in results]
    threshold = sorted(outs)[int(len(outs) * 0.75)]
    labels = [o >= threshold for o in outs]
    top = sorted(range(len(results)), key=lambda i: -opps[i])[:10]  # de kopscore in de UI
    top_val = sorted(range(len(results)), key=lambda i: -vals[i])[:10]
    metrics = {
        "n": len(results),
        "spearman_validation": round(spearman(vals, outs), 3),
        "spearman_opportunity": round(spearman(opps, outs), 3),
        "precision_at_10": round(sum(labels[i] for i in top) / len(top), 2),
        "precision_at_10_validation": round(sum(labels[i] for i in top_val) / len(top_val), 2),
        "auc_opportunity": round(a, 3) if (a := auc(opps, labels)) is not None else None,
        "auc_validation": round(b, 3) if (b := auc(vals, labels)) is not None else None,
        "base_rate": round(sum(labels) / len(labels), 2),
    }
    top_rows = [
        {
            "cluster_id": results[i].entity_id,
            "validation": results[i].validation,
            "opportunity": results[i].opportunity,
            "phase": results[i].phase,
            "later_growth_pct": round((math.exp(outs[i]) - 1) * 100, 1),
            "breakout": labels[i],
        }
        for i in top
    ]
    return metrics, top_rows


def run_backtests(
    conn: psycopg.Connection[Any], ch: ClickHouse, today: date, horizons: Sequence[int] = (14, 21, 30)
) -> list[dict[str, Any]]:
    row = conn.execute("SELECT version, weights FROM score_weights WHERE is_active").fetchone()
    version, weights = (int(row[0]), dict(row[1])) if row else (1, {})
    inputs = build_inputs(conn, load_series(ch, today))
    out = []
    for h in horizons:
        metrics, top = evaluate(inputs, h, weights)
        if metrics.get("n", 0) < 8:
            continue
        conn.execute(
            """INSERT INTO backtests (cutoff, horizon_days, weights_version, metrics, top) VALUES (%s, %s, %s, %s, %s)""",
            (today - timedelta(days=h), h, version, Jsonb(metrics), Jsonb(top)),
        )
        out.append({"horizon": h, **metrics})
    conn.commit()
    return out
