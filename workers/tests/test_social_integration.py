"""Integratie: TikTok-partner, YouTube en Instagram → shops, producten, creators, video's, lives → signalen. RUN_INTEGRATION=1."""

import os

import psycopg
import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("RUN_INTEGRATION"), reason="zet RUN_INTEGRATION=1"),
]

SOCIAL = "('tiktok_shop_partner', 'youtube_data', 'instagram_business')"


@pytest.fixture(scope="module")
def world():
    from trendscope.core.clickhouse import get_client
    from trendscope.core.settings import get_settings
    from trendscope.mockweb.tiktok_world import reset_tiktok_caches
    from trendscope.mockweb.world import reset_caches
    from trendscope.seed.generate import run

    run()
    reset_caches()
    reset_tiktok_caches()
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        yield conn, get_client(), settings


def _run_day(world, day):
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    ids = conn.execute(
        f"SELECT id FROM crawl_targets WHERE connector_id IN {SOCIAL} ORDER BY (target LIKE 'cat:%%') DESC, id"  # noqa: S608
    ).fetchall()
    transport = MockWebTransport(day=day)
    outcomes = [run_target(conn, ch, settings, tid, now=day_timestamp(day, 9), transport=transport) for (tid,) in ids]
    assert all(o.status == "succeeded" for o in outcomes), [o.error for o in outcomes if o.status != "succeeded"]
    return outcomes


def test_discovery_then_shops_creators_and_lives(world):
    conn, _, _ = world
    _run_day(world, 1)  # categorie-ontdekking maakt shop- en creator-targets
    _run_day(world, 2)
    _run_day(world, 3)
    shops, sold = conn.execute("SELECT count(*), sum(sold_30d) FROM tiktok_shops").fetchone()
    assert shops >= 20 and sold > 0
    unclustered = conn.execute(
        """SELECT count(*) FROM products p WHERE p.source = 'tiktok_shop'
           AND NOT EXISTS (SELECT 1 FROM cluster_members m WHERE m.product_id = p.id)"""
    ).fetchone()[0]
    assert unclustered == 0, "elk TikTok Shop-product hoort bij een bestaand product"
    gmv = conn.execute("SELECT gmv_30d FROM tiktok_shops WHERE sold_30d > 0 LIMIT 1").fetchone()[0]
    assert gmv["low"] < gmv["value"] < gmv["high"] and gmv["confidence"] == "medium" and gmv["method"]
    lives, units = conn.execute("SELECT count(*), sum(units_sold) FROM livestreams").fetchone()
    assert lives > 0 and units > 0
    anchored = conn.execute("SELECT count(*) FROM videos WHERE product_id IS NOT NULL").fetchone()[0]
    assert anchored > 50


def test_creators_are_public_business_only(world):
    conn, _, _ = world
    rows = conn.execute("SELECT contact_public FROM creators WHERE contact_public IS NOT NULL").fetchall()
    assert rows and all(set(r[0]) <= {"business_email"} for r in rows)
    platforms = dict(conn.execute("SELECT platform::text, count(*) FROM creators GROUP BY 1").fetchall())
    assert platforms.get("youtube", 0) > 0 and platforms.get("instagram", 0) > 0


def test_idempotent_rerun(world):
    conn, _, _ = world
    counts = conn.execute(
        "SELECT (SELECT count(*) FROM tiktok_shops), (SELECT count(*) FROM videos), (SELECT count(*) FROM livestreams)"
    ).fetchone()
    _run_day(world, 3)
    assert (
        conn.execute(
            "SELECT (SELECT count(*) FROM tiktok_shops), (SELECT count(*) FROM videos), (SELECT count(*) FROM livestreams)"
        ).fetchone()
        == counts
    )


def test_social_and_tiktokshop_signals(world):
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scoring.live import aggregate_signals

    conn, ch, settings = world
    day = day_timestamp(3, 23).date()
    aggregate_signals(conn, ch, day, country=settings.trend_country)
    rows = ch.query(
        """SELECT source, count(), sum(value) FROM entity_signals_daily FINAL
           WHERE entity_type = 'product_cluster' AND date = {d:Date} AND source IN ('social', 'tiktokshop') GROUP BY source""",
        parameters={"d": day},
    ).result_rows
    by = {r[0]: (r[1], r[2]) for r in rows}
    assert by["tiktokshop"][0] > 10 and by["tiktokshop"][1] > 0
    assert by["social"][0] > 10 and by["social"][1] > 0
