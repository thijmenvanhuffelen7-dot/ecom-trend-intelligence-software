"""Mock-modus: speel de afgelopen dagen af op het nep-internet, met de échte pipeline.

Elke gesimuleerde dag crawlt elke winkel één keer (op een vast tijdstip per winkel) en draait discovery.
Resultaat: een realistische tijdlijn met nieuwe/verwijderde producten, prijswijzigingen en nieuwe winkels.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from typing import Any

import psycopg

from trendscope.core.clickhouse import get_client
from trendscope.core.settings import Settings
from trendscope.mockweb.transport import MockWebTransport
from trendscope.mockweb.world import day_timestamp, reset_caches
from trendscope.scheduler.runner import run_target


def simulate(settings: Settings, days: int, *, progress: bool = True) -> dict[str, Any]:
    if settings.data_mode != "mock":
        raise RuntimeError("simulate werkt alleen met DATA_MODE=mock")
    reset_caches()
    ch = get_client()
    totals: Counter[str] = Counter()
    with psycopg.connect(settings.database_url) as conn:
        for day in range(1, days + 1):
            transport = MockWebTransport(day=day)
            if settings.discovery_keywords:
                from trendscope.discovery.run import discover_and_probe

                found = discover_and_probe(conn, settings, now=day_timestamp(day, 4), transport=transport)
                totals.update({f"discovery_{k}": v for k, v in found.items()})
            targets = conn.execute(
                "SELECT id, entity_id FROM crawl_targets WHERE connector_id = 'shopify_storefront' ORDER BY id"
            ).fetchall()
            for target_id, entity_id in targets:
                now = day_timestamp(day, 6) + timedelta(minutes=int(entity_id or 0) * 7 % 600)
                outcome = run_target(conn, ch, settings, target_id, now=now, transport=transport)
                if outcome:
                    totals.update(e.type for e in outcome.events)
                    totals["crawls"] += 1
            if progress:
                print(
                    f"  dag {day}/{days}: {totals['crawls']} crawls, {totals['product_added']} nieuw, "
                    f"{totals['price_changed']} prijswijzigingen, {totals.get('discovery_accepted', 0)} winkels ontdekt"
                )
    return dict(totals)
