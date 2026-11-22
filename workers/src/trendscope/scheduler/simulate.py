"""Mock-modus: speel de afgelopen dagen af op het nep-internet, met de échte pipeline.

Elke gesimuleerde dag crawlt elke winkel één keer (op een vast tijdstip per winkel) en draait discovery.
Resultaat: een realistische tijdlijn met nieuwe/verwijderde producten, prijswijzigingen en nieuwe winkels.
"""

from __future__ import annotations

import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from functools import partial
from typing import Any

import psycopg

from trendscope.core.clickhouse import get_client
from trendscope.core.settings import Settings
from trendscope.mockweb.ads_world import reset_ads_caches
from trendscope.mockweb.transport import MockWebTransport
from trendscope.mockweb.trend_world import reset_trend_caches
from trendscope.mockweb.world import day_timestamp, reset_caches
from trendscope.pipeline.store_crawl import CrawlOutcome
from trendscope.scheduler.runner import run_target
from trendscope.scoring.live import run_daily
from trendscope.trends.ingest import refresh_hashtags

_local = threading.local()


def _run_one(
    settings: Settings, target_id: int, entity_id: int, day: int, transport: MockWebTransport
) -> CrawlOutcome | None:
    """Eén crawl in een workerthread, met een eigen database- en ClickHouse-verbinding per thread."""
    if getattr(_local, "conn", None) is None:
        _local.conn = psycopg.connect(settings.database_url)
        _local.ch = get_client()
    now = day_timestamp(day, 6) + timedelta(minutes=int(entity_id or 0) * 7 % 600)
    return run_target(_local.conn, _local.ch, settings, target_id, now=now, transport=transport)


def simulate(settings: Settings, days: int, *, progress: bool = True, workers: int = 8) -> dict[str, Any]:
    if settings.data_mode != "mock":
        raise RuntimeError("simulate werkt alleen met DATA_MODE=mock")
    reset_caches()
    reset_ads_caches()
    reset_trend_caches()
    totals: Counter[str] = Counter()
    ch_main = None
    with psycopg.connect(settings.database_url) as conn:
        for day in range(1, days + 1):
            transport = MockWebTransport(day=day)
            if settings.discovery_keywords:
                from trendscope.discovery.run import discover_and_probe

                found = discover_and_probe(conn, settings, now=day_timestamp(day, 4), transport=transport)
                totals.update({f"discovery_{k}": v for k, v in found.items()})
            # Eerst winkels (nieuwe producten), dan ads (koppelen aan die producten), zoektermen als laatste.
            # Binnen een fase parallel, zoals meerdere workers in productie.
            targets = conn.execute(
                """SELECT id, coalesce(entity_id, id),
                          CASE WHEN connector_id = 'shopify_storefront' THEN 0 WHEN target LIKE 'q:%%' THEN 2 ELSE 1 END
                   FROM crawl_targets ORDER BY 3, id"""
            ).fetchall()
            for phase in (0, 1, 2):
                batch = [(tid, eid) for tid, eid, ph in targets if ph == phase]
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    for outcome in pool.map(
                        partial(_run_one, settings, day=day, transport=transport),
                        *zip(*batch, strict=True) if batch else ([], []),
                    ):
                        if outcome:
                            totals.update(e.type for e in outcome.events)
                            totals.update(
                                {
                                    k: v
                                    for k, v in outcome.stats.items()
                                    if k.startswith(("ad_", "listing_", "mp_")) and isinstance(v, int)
                                }
                            )
                            totals["crawls"] += 1
            # Zoals de beat-job: wat vandaag nieuw binnenkwam (winkels + marktplaatsen) clusteren
            from trendscope.clustering.engine import cluster_products

            cstats = cluster_products(conn, now=day_timestamp(day, 23)).as_dict()
            totals.update({f"cluster_{k}": v for k, v in cstats.items()})
            # Zoals de dagelijkse beat-job: hashtags, signalen en scores voor deze dag
            if ch_main is None:
                ch_main = get_client()
            totals.update(refresh_hashtags(conn, ch_main, day_timestamp(day, 23)))
            sstats = run_daily(
                conn, ch_main, day_timestamp(day, 23).date(), day_timestamp(day, 23), country=settings.trend_country
            )
            totals["scored"] = sstats["scored"]
            if progress:
                print(
                    f"  dag {day}/{days}: {totals['crawls']} crawls, {totals['product_added']} nieuw, "
                    f"{totals['price_changed']} prijswijzigingen, {totals.get('discovery_accepted', 0)} winkels ontdekt, "
                    f"{totals['cluster_new_clusters']} nieuwe clusters, {totals['scored']} gescoord"
                )
        # Vandaag: scores op basis van alles wat tot en met gisteren is gemeten, plus backtests
        if ch_main is not None:
            from datetime import UTC, datetime

            from trendscope.scoring.backtest import run_backtests

            today = datetime.now(UTC)
            totals.update(
                {
                    f"today_{k}": v
                    for k, v in run_daily(conn, ch_main, today.date(), today, country=settings.trend_country).items()
                }
            )
            totals["backtests"] = len(run_backtests(conn, ch_main, today.date()))
    return dict(totals)
