"""Integratietest: vereist draaiende Postgres + ClickHouse met migraties (make dev-services && make migrate)."""

import os

import psycopg
import pytest

pytestmark = pytest.mark.integration


@pytest.mark.skipif(not os.environ.get("RUN_INTEGRATION"), reason="zet RUN_INTEGRATION=1")
def test_seed_produces_linked_world():
    from trendscope.core.settings import get_settings
    from trendscope.seed.generate import run

    counts = run()
    assert counts["stores"] == 180 and counts["clusters"] == 72
    with psycopg.connect(get_settings().database_url) as conn:
        phases = dict(conn.execute("select phase, count(*) from scores group by phase").fetchall())
        # alle trendfases komen voor, zodat de UI elk pad laat zien
        assert set(phases) == {"emerging", "rising", "peak", "saturated", "declining"}
        orphan = conn.execute(
            "select count(*) from product_clusters c where not exists "
            "(select 1 from entity_links l where l.to_id = c.id and l.to_type = 'product_cluster')"
        ).fetchone()
        assert orphan == (0,), "elk productcluster moet gekoppeld zijn aan winkels/ads/creators"
