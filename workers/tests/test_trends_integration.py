"""Integratie: trend-connectors → keywords → live scoring → backtest, tegen Postgres + ClickHouse + nep-internet.

RUN_INTEGRATION=1.
"""

import os
from datetime import timedelta

import psycopg
import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("RUN_INTEGRATION"), reason="zet RUN_INTEGRATION=1"),
]


@pytest.fixture(scope="module")
def world():
    from trendscope.core.clickhouse import get_client
    from trendscope.core.settings import get_settings
    from trendscope.mockweb.trend_world import reset_trend_caches
    from trendscope.mockweb.world import reset_caches
    from trendscope.seed.generate import run

    run()
    reset_caches()
    reset_trend_caches()
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        yield conn, get_client(), settings


def _run(world, day, where="TRUE"):
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    ids = conn.execute(
        f"SELECT id FROM crawl_targets WHERE connector_id IN ('dataforseo_trends', 'reddit') AND {where} ORDER BY id"  # noqa: S608
    ).fetchall()
    transport = MockWebTransport(day=day)
    return [run_target(conn, ch, settings, tid, now=day_timestamp(day, 7), transport=transport) for (tid,) in ids]


def test_keywords_get_phase_season_and_forecast(world):
    conn, _, _ = world
    outcomes = _run(world, 1, "(target LIKE '%|NL' OR connector_id = 'reddit')")
    assert all(o.status == "succeeded" for o in outcomes)
    rows = dict(
        conn.execute(
            "SELECT term, phase::text FROM keywords WHERE term IN ('cortisol cocktail', 'magnetic lashes')"
        ).fetchall()
    )
    assert rows == {"cortisol cocktail": "emerging", "magnetic lashes": "declining"}
    peak = conn.execute("SELECT peak_month FROM keywords WHERE term = 'pool float'").fetchone()[0]
    assert peak == 7
    no_season = conn.execute("SELECT peak_month FROM keywords WHERE term = 'cortisol cocktail'").fetchone()[0]
    assert no_season is None, "een stijger is geen seizoen"
    n = conn.execute("SELECT count(*) FROM forecasts WHERE entity_type = 'keyword'").fetchone()[0]
    assert n > 50


def test_reddit_is_idempotent_and_stores_no_usernames(world):
    conn, _, _ = world
    before = conn.execute("SELECT count(*) FROM reddit_mentions").fetchone()[0]
    assert before > 100
    _run(world, 1, "connector_id = 'reddit'")
    assert conn.execute("SELECT count(*) FROM reddit_mentions").fetchone()[0] == before
    cols = {
        r[0]
        for r in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'reddit_mentions'")
    }
    assert not cols & {"author", "username", "user"}


def test_live_scoring_calibrates_and_scores(world):
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scoring.live import run_daily
    from trendscope.trends.ingest import refresh_hashtags

    conn, ch, settings = world
    now = day_timestamp(1, 23)
    tags = refresh_hashtags(conn, ch, now)
    assert tags["hashtags"] > 10
    stats = run_daily(conn, ch, now.date(), now, country=settings.trend_country)
    assert stats["scored"] == 72 and stats["forecasts"] >= 60
    lo, hi = conn.execute("SELECT min(factor), max(factor) FROM signal_scales").fetchone()
    assert lo >= 0.05 and hi <= 20
    # Tweede keer dezelfde dag: kalibratie ligt vast, geen nieuwe factoren
    n = conn.execute("SELECT count(*) FROM signal_scales").fetchone()[0]
    run_daily(conn, ch, now.date(), now, country=settings.trend_country)
    assert conn.execute("SELECT count(*) FROM signal_scales").fetchone()[0] == n
    # Elke score is uitgelegd
    row = conn.execute("SELECT breakdown FROM scores WHERE entity_type = 'product_cluster' LIMIT 1").fetchone()[0]
    assert {"signals", "positive_signals", "notes"} <= set(row)


def test_backtest_beats_chance(world):
    from trendscope.scoring.backtest import run_backtests

    conn, ch, _ = world
    today = conn.execute("SELECT max(date) FROM scores").fetchone()[0]
    results = run_backtests(conn, ch, today + timedelta(days=0))
    assert results, "minstens één horizon met genoeg producten"
    for r in results:
        assert r["spearman_validation"] > 0.2, r
        assert r["auc_validation"] > 0.55, r  # beter dan toeval (0,5)
