"""Live scoring: dagelijks de signalen per productcluster uit de echte data afleiden en alle clusters scoren.

Signalen (dagwaarde), elk in dezelfde eenheid als de bestaande historie:
- store        aantal winkels dat het product (nog) verkoopt
- ads          aantal actieve, gekoppelde ads
- marketplace  marktplaatsverkopen per dag (AliExpress orders_30d/30 + Amazon-schatting uit BSR/30)
- search       som van de zoekinteresse (index) van gekoppelde keywords; hele reeks, niet alleen vandaag
- reddit       Reddit-vermeldingen per dag
- social / tiktokshop volgen in fase 6

Waar een niveausignaal (store/ads/marketplace) voor het eerst live wordt gemeten terwijl er al historie is
(seed of backfill), leggen we één schaalfactor vast (gemiddelde van de 7 dagen ervoor / eerste live meting) in
`signal_scales`. Zo ontstaat er geen kunstmatige sprong, en blijft de keuze controleerbaar.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from statistics import median
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.types.json import Jsonb

from trendscope.scoring.engine import DEMAND_SIGNALS, EntityInput, Signal, score_population
from trendscope.trends.forecast import forecast

SERIES_DAYS = 90
LEVEL_SIGNALS = ("store", "ads", "marketplace", "tiktokshop", "social")  # gekalibreerd op bestaande historie
DEFAULT_SHIPPING = 4.5
MIN_DAYS = 7


def _raw_levels(conn: psycopg.Connection[Any]) -> dict[int, dict[str, float]]:
    out: dict[int, dict[str, float]] = defaultdict(dict)
    rows = conn.execute(
        """SELECT c.id,
             (SELECT count(DISTINCT p.store_id) FROM cluster_members m JOIN products p ON p.id = m.product_id
              WHERE m.cluster_id = c.id AND p.store_id IS NOT NULL AND p.status <> 'removed') AS stores,
             (SELECT count(*) FROM entity_links l JOIN ads a ON a.id = l.from_id
              WHERE l.from_type = 'ad' AND l.to_type = 'product_cluster' AND l.to_id = c.id AND a.is_active) AS ads,
             (SELECT sum(coalesce(p.orders_30d, 0) + coalesce((p.est_monthly_sales->>'value')::numeric, 0)) / 30.0
              FROM cluster_members m JOIN products p ON p.id = m.product_id
              WHERE m.cluster_id = c.id AND p.store_id IS NULL AND p.status <> 'removed') AS marketplace
           FROM product_clusters c"""
    ).fetchall()
    for cid, stores, ads, mp in rows:
        out[int(cid)]["store"] = float(stores or 0)
        out[int(cid)]["ads"] = float(ads or 0)
        if mp is not None:
            out[int(cid)]["marketplace"] = float(mp)
    return out


def _flows(conn: psycopg.Connection[Any], ch: ClickHouse, day: date, out: dict[int, dict[str, float]]) -> None:
    """Stromen per dag: TikTok Shop-verkopen (Δ teller) en videoviews (Δ views), opgeteld per cluster."""
    end = datetime.combine(day + timedelta(days=1), datetime.min.time())
    prod_cluster = {
        int(p): int(c)
        for p, c in conn.execute(
            """SELECT p.id, m.cluster_id FROM products p JOIN cluster_members m ON m.product_id = p.id
               WHERE p.source = 'tiktok_shop'"""
        )
    }
    if prod_cluster:
        for pid, delta in ch.query(
            """SELECT product_id,
                 toInt64(argMaxIf(orders, captured_at, captured_at < {end:DateTime}))
                 - toInt64(argMaxIf(orders, captured_at, captured_at < {prev:DateTime}))
               FROM product_snapshots WHERE product_id IN {ids:Array(UInt64)} AND orders IS NOT NULL
                 AND captured_at < {end:DateTime}
               GROUP BY product_id HAVING countIf(captured_at < {prev:DateTime}) > 0""",
            parameters={"ids": list(prod_cluster), "end": end, "prev": end - timedelta(days=1)},
        ).result_rows:
            cid = prod_cluster[int(pid)]
            out[cid]["tiktokshop"] = out[cid].get("tiktokshop", 0.0) + max(0, int(delta))
    video_cluster: dict[int, list[int]] = defaultdict(list)
    for vid, cid in conn.execute(
        "SELECT from_id, to_id FROM entity_links WHERE from_type = 'video' AND to_type = 'product_cluster'"
    ):
        video_cluster[int(vid)].append(int(cid))
    if video_cluster:
        for vid, delta in ch.query(
            """SELECT video_id,
                 toInt64(argMaxIf(views, captured_at, captured_at < {end:DateTime}))
                 - toInt64(argMaxIf(views, captured_at, captured_at < {prev:DateTime}))
               FROM video_snapshots WHERE video_id IN {ids:Array(UInt64)} AND captured_at < {end:DateTime}
               GROUP BY video_id HAVING countIf(captured_at < {prev:DateTime}) > 0""",
            parameters={"ids": list(video_cluster), "end": end, "prev": end - timedelta(days=1)},
        ).result_rows:
            for cid in video_cluster[int(vid)]:
                out[cid]["social"] = out[cid].get("social", 0.0) + max(0, int(delta))


def _history_means(ch: ClickHouse, day: date) -> dict[tuple[int, str], float]:
    rows = ch.query(
        """SELECT entity_id, source, avg(value) FROM entity_signals_daily FINAL
           WHERE entity_type = 'product_cluster' AND date >= {start:Date} AND date < {day:Date}
             AND source IN ('store', 'ads', 'marketplace', 'tiktokshop', 'social')
           GROUP BY entity_id, source""",
        parameters={"start": day - timedelta(days=7), "day": day},
    ).result_rows
    return {(int(r[0]), str(r[1])): float(r[2]) for r in rows}


def aggregate_signals(conn: psycopg.Connection[Any], ch: ClickHouse, day: date, *, country: str) -> int:
    """Schrijft de signalen van `day` (en de volledige zoek- en Reddit-reeks) naar entity_signals_daily."""
    raw = _raw_levels(conn)
    _flows(conn, ch, day, raw)
    scales = {
        (int(r[0]), str(r[1])): float(r[2])
        for r in conn.execute(
            "SELECT entity_id, source, factor FROM signal_scales WHERE entity_type = 'product_cluster'"
        )
    }
    history = _history_means(ch, day)
    rows: list[list[Any]] = []
    with conn.cursor() as cur:
        for cid, values in raw.items():
            for source in LEVEL_SIGNALS:
                if source not in values:
                    continue
                value = values[source]
                key = (cid, source)
                if key not in scales:
                    prev = history.get(key)
                    factor = prev / value if prev and value > 0 else 1.0
                    factor = max(0.05, min(20.0, factor))
                    scales[key] = factor
                    cur.execute(
                        """INSERT INTO signal_scales (entity_type, entity_id, source, factor, basis)
                           VALUES ('product_cluster', %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (
                            cid,
                            source,
                            factor,
                            Jsonb({"history_mean": prev, "first_live": value, "date": day.isoformat()}),
                        ),
                    )
                rows.append(["product_cluster", cid, source, day, round(value * scales[key], 3)])
    conn.commit()

    # Zoekinteresse: som van gekoppelde keywords, hele venster (de bron levert steeds een volledig venster)
    links = conn.execute(
        """SELECT l.to_id, l.from_id FROM entity_links l JOIN keywords k ON k.id = l.from_id
           WHERE l.from_type = 'keyword' AND l.to_type = 'product_cluster' AND k.kind = 'keyword'"""
    ).fetchall()
    kw_to_clusters: dict[int, list[int]] = defaultdict(list)
    for cid, kid in links:
        kw_to_clusters[int(kid)].append(int(cid))
    if kw_to_clusters:
        start = day - timedelta(days=SERIES_DAYS - 1)
        result = ch.query(
            """SELECT keyword_id, source, date, argMax(value, updated_at) FROM keyword_signals_daily
               WHERE keyword_id IN {ids:Array(UInt64)} AND date >= {start:Date} AND date <= {day:Date}
                 AND ((source = 'search' AND country = {c:String}) OR source = 'reddit')
               GROUP BY keyword_id, source, date""",
            parameters={"ids": list(kw_to_clusters), "start": start, "day": day, "c": country},
        ).result_rows
        sums: dict[tuple[int, str, date], float] = defaultdict(float)
        for kid, source, d, value in result:
            for cid in kw_to_clusters[int(kid)]:
                sums[(cid, str(source), d)] += float(value)
        rows += [["product_cluster", cid, source, d, round(v, 2)] for (cid, source, d), v in sums.items()]
    if rows:
        ch.insert("entity_signals_daily", rows, column_names=["entity_type", "entity_id", "source", "date", "value"])
    return len(rows)


def load_series(ch: ClickHouse, day: date, days: int = SERIES_DAYS) -> dict[int, dict[Signal, list[float]]]:
    """Reeksen per cluster en signaal, oudste eerst; ontbrekende dagen binnen een reeks worden 0."""
    start = day - timedelta(days=days - 1)
    rows = ch.query(
        """SELECT entity_id, source, date, value FROM entity_signals_daily FINAL
           WHERE entity_type = 'product_cluster' AND date >= {start:Date} AND date <= {day:Date}
           ORDER BY entity_id, source, date""",
        parameters={"start": start, "day": day},
    ).result_rows
    raw: dict[int, dict[str, dict[date, float]]] = defaultdict(lambda: defaultdict(dict))
    for eid, source, d, v in rows:
        raw[int(eid)][str(source)][d] = float(v)
    out: dict[int, dict[Signal, list[float]]] = {}
    valid = {s.value for s in Signal}
    for eid, per_source in raw.items():
        series: dict[Signal, list[float]] = {}
        for source, points in per_source.items():
            if source not in valid:
                continue
            first, last = min(points), max(points)
            n = (last - first).days + 1  # tot de laatst gemeten dag: een nog niet gemeten "vandaag" is geen 0
            series[Signal(source)] = [points.get(first + timedelta(days=i), 0.0) for i in range(n)]
        out[eid] = series
    return out


def _margins(conn: psycopg.Connection[Any]) -> dict[int, float]:
    """(verkoopprijs − goedkoopste geleverde inkoop) / verkoopprijs. Verkoopprijs = mediaan in winkels, anders Amazon."""
    prices: dict[int, list[float]] = defaultdict(list)
    for cid, price in conn.execute(
        """SELECT m.cluster_id, p.price FROM cluster_members m JOIN products p ON p.id = m.product_id
           WHERE p.price > 0 AND p.status <> 'removed' AND (p.store_id IS NOT NULL OR p.source = 'amazon')"""
    ):
        prices[int(cid)].append(float(price))
    costs = {
        int(cid): (float(price), float(ship) if ship else DEFAULT_SHIPPING)
        for cid, price, ship in conn.execute(
            """SELECT DISTINCT ON (cluster_id) cluster_id, price, shipping_cost FROM supplier_offers
               WHERE cluster_id IS NOT NULL AND price > 0 ORDER BY cluster_id, price + coalesce(shipping_cost, 0)"""
        )
    }
    out = {}
    for cid, ps in prices.items():
        if cid not in costs:
            continue
        sale = median(ps)
        cost, ship = costs[cid]
        out[cid] = round((sale - cost - ship) / sale, 3) if sale > 0 else 0.0
    return out


def build_inputs(conn: psycopg.Connection[Any], series: dict[int, dict[Signal, list[float]]]) -> list[EntityInput]:
    margins = _margins(conn)
    rows = conn.execute(
        """SELECT c.id, c.store_count, coalesce(n.slug, 'unknown'),
             (SELECT count(DISTINCT a.advertiser_id) FROM entity_links l JOIN ads a ON a.id = l.from_id
              WHERE l.from_type = 'ad' AND l.to_type = 'product_cluster' AND l.to_id = c.id) AS advertisers
           FROM product_clusters c LEFT JOIN niches n ON n.id = c.niche_id"""
    ).fetchall()
    return [
        EntityInput(
            entity_id=int(cid),
            series=series.get(int(cid), {}),
            store_count=int(stores or 0),
            advertiser_count=int(advertisers or 0),
            margin=margins.get(int(cid)),
            category=str(niche),
        )
        for cid, stores, niche, advertisers in rows
    ]


def demand_index(series: Mapping[Signal, Sequence[float]]) -> list[float]:
    """Gemiddelde van de vraagsignalen, elk geschaald op zijn eigen gemiddelde (×100)."""
    parts = [s for sig in DEMAND_SIGNALS if (s := series.get(sig)) and len(s) >= 28 and sum(s) > 0]
    if not parts:
        return []
    n = min(len(p) for p in parts)
    scaled = [[v / (sum(p[-n:]) / n) * 100 for v in p[-n:]] for p in parts]
    return [round(sum(col) / len(col), 2) for col in zip(*scaled, strict=True)]


def score_all(conn: psycopg.Connection[Any], ch: ClickHouse, day: date, now: datetime) -> dict[str, int]:
    weights_row = conn.execute("SELECT version, weights FROM score_weights WHERE is_active").fetchone()
    version, weights = (int(weights_row[0]), dict(weights_row[1])) if weights_row else (1, {})
    series = load_series(ch, day)
    # Pas scoren met minstens een week data; daarvoor toont de UI "Score volgt"
    all_inputs = build_inputs(conn, series)
    inputs = [i for i in all_inputs if i.series and max(len(v) for v in i.series.values()) >= MIN_DAYS]
    results = score_population(inputs, weights)
    history: list[list[Any]] = []
    with conn.cursor() as cur:
        for r in results:
            cur.execute(
                """INSERT INTO scores (entity_type, entity_id, date, growth_velocity, validation, saturation, opportunity,
                     phase, breakdown, weights_version, computed_at)
                   VALUES ('product_cluster', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (entity_type, entity_id) DO UPDATE SET date = EXCLUDED.date,
                     growth_velocity = EXCLUDED.growth_velocity, validation = EXCLUDED.validation,
                     saturation = EXCLUDED.saturation, opportunity = EXCLUDED.opportunity, phase = EXCLUDED.phase,
                     breakdown = EXCLUDED.breakdown, weights_version = EXCLUDED.weights_version,
                     computed_at = EXCLUDED.computed_at""",
                (
                    r.entity_id,
                    day,
                    r.growth_velocity,
                    r.validation,
                    r.saturation,
                    r.opportunity,
                    r.phase,
                    Jsonb(r.breakdown),
                    version,
                    now,
                ),
            )
            history.append(
                [
                    "product_cluster",
                    r.entity_id,
                    day,
                    r.growth_velocity,
                    r.validation,
                    r.saturation,
                    r.opportunity,
                    r.phase,
                    version,
                ]
            )
        forecasts = 0
        for e in inputs:
            idx = demand_index(e.series)
            fc = forecast(idx, day) if idx else None
            if fc is None:
                continue
            forecasts += 1
            cur.execute(
                """INSERT INTO forecasts (entity_type, entity_id, source, computed_at, method, points, mape, trend_30d)
                   VALUES ('product_cluster', %s, 'demand', %s, %s, %s, %s, %s)
                   ON CONFLICT (entity_type, entity_id, source) DO UPDATE SET computed_at = EXCLUDED.computed_at,
                     method = EXCLUDED.method, points = EXCLUDED.points, mape = EXCLUDED.mape, trend_30d = EXCLUDED.trend_30d""",
                (e.entity_id, now, fc.method, Jsonb(fc.points), fc.mape, fc.trend_30d),
            )
    conn.commit()
    if history:
        ch.insert(
            "score_history",
            history,
            column_names=[
                "entity_type",
                "entity_id",
                "date",
                "growth_velocity",
                "validation",
                "saturation",
                "opportunity",
                "phase",
                "weights_version",
            ],
        )
    return {"scored": len(results), "forecasts": forecasts, "pending": len(all_inputs) - len(inputs)}


def run_daily(
    conn: psycopg.Connection[Any], ch: ClickHouse, day: date, now: datetime, *, country: str
) -> dict[str, int]:
    written = aggregate_signals(conn, ch, day, country=country)
    stats = score_all(conn, ch, day, now)
    return {"signal_points": written, **stats}
