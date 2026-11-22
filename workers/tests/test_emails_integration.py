"""Integratie: inschrijven via het winkelformulier → mails inlezen → classificatie, productlinks, winkelstatistieken.

RUN_INTEGRATION=1.
"""

import os

import psycopg
import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("RUN_INTEGRATION"), reason="zet RUN_INTEGRATION=1"),
]


@pytest.fixture(scope="module")
def world():
    from trendscope.core.settings import get_settings
    from trendscope.mockweb.world import reset_caches
    from trendscope.seed.generate import run

    run()
    reset_caches()
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        yield conn, settings


def _cycle(world, day, subscribe):
    from trendscope.connectors.base import load_manifests
    from trendscope.core.clients import http_client_for
    from trendscope.emails.ingest import mock_source, run_email_cycle
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp

    conn, settings = world
    transport = MockWebTransport(day=day)
    with http_client_for(load_manifests()["seed_mailbox"], settings, transport=transport) as client:
        return run_email_cycle(
            conn, settings, day_timestamp(day, 7), client=client, source=mock_source(conn, day), subscribe=subscribe
        ), transport


def test_subscribe_respects_captcha(world):
    conn, settings = world
    stats, transport = _cycle(world, 1, True)
    assert stats["subscribe_subscribed"] > 10
    statuses = dict(conn.execute("SELECT status, count(*) FROM email_subscriptions GROUP BY 1").fetchall())
    assert statuses.get("manual", 0) >= 1, "winkels met CAPTCHA worden handmatig, niet omzeild"
    # alleen winkels met een e-mailtool, elk met een eigen plus-adres
    n, distinct = conn.execute("SELECT count(*), count(DISTINCT address) FROM email_subscriptions").fetchone()
    assert n == distinct and n <= settings.email_track_stores
    assert any("/contact" in u for u in transport.requests)


def test_mails_are_classified_linked_and_idempotent(world):
    conn, _ = world
    stats, _ = _cycle(world, 8, False)
    assert stats["mail_new"] > 50 and stats["mail_unmatched"] == 0
    types = dict(conn.execute("SELECT type, count(*) FROM emails GROUP BY 1").fetchall())
    assert types.get("welcome", 0) > 5 and types.get("promotion", 0) > 5 and types.get("confirmation", 0) > 5
    confirmed = conn.execute("SELECT count(*) FROM email_subscriptions WHERE status = 'confirmed'").fetchone()[0]
    assert confirmed > 5
    linked = conn.execute(
        "SELECT count(*) FROM emails WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(links) l WHERE l ? 'product_id')"
    ).fetchone()[0]
    assert linked > 5, "lanceringsmails linken naar echte producten van de winkel"
    row = conn.execute("SELECT discount_pct, discount_code, esp FROM emails WHERE type = 'welcome' LIMIT 1").fetchone()
    assert row[0] and row[1] and row[1].startswith("WELCOME") and row[2]
    per_week = conn.execute(
        "SELECT count(*) FROM stores WHERE emails_per_week > 0 AND email_esp IS NOT NULL"
    ).fetchone()[0]
    assert per_week > 5
    # opnieuw synchroniseren levert niets dubbel op
    total = conn.execute("SELECT count(*) FROM emails").fetchone()[0]
    stats2, _ = _cycle(world, 8, False)
    assert stats2["mail_new"] == 0 and conn.execute("SELECT count(*) FROM emails").fetchone()[0] == total


def test_funnel_apps_detected_on_crawl(world):
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, settings = world
    from trendscope.core.clickhouse import get_client

    tid, domain = conn.execute(
        "SELECT t.id, t.target FROM crawl_targets t WHERE connector_id = 'shopify_storefront' ORDER BY id LIMIT 1"
    ).fetchone()
    out = run_target(conn, get_client(), settings, tid, now=day_timestamp(2, 9), transport=MockWebTransport(day=2))
    assert out.status == "succeeded"
    from trendscope.seed.catalog import funnel_apps

    found = {
        r[0]
        for r in conn.execute(
            "SELECT t.name FROM store_technologies t JOIN stores s ON s.id = t.store_id WHERE s.domain = %s AND removed_at IS NULL",
            (domain,),
        )
    }
    assert set(funnel_apps(domain)) <= found
