"""Integratie: echte pipeline tegen Postgres + ClickHouse + het nep-internet. RUN_INTEGRATION=1."""

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
    from trendscope.mockweb.world import reset_caches
    from trendscope.seed.generate import run

    run()
    reset_caches()
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        yield conn, get_client(), settings


def _target(conn, where="t.connector_id = 'shopify_storefront'"):
    return conn.execute(
        f"SELECT t.id, t.target, t.entity_id FROM crawl_targets t WHERE {where} ORDER BY t.id LIMIT 1"
    ).fetchone()


def test_crawl_is_incremental_and_idempotent(world):
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    tid, domain, store_id = _target(conn)
    transport = MockWebTransport(day=0)
    first = run_target(conn, ch, settings, tid, now=day_timestamp(0), transport=transport)
    assert first.status == "succeeded"
    # dag 0 = exact de geseede staat → geen productwijzigingen
    assert [e for e in first.events if e.type.startswith(("product", "price"))] == []

    later = run_target(conn, ch, settings, tid, now=day_timestamp(10), transport=MockWebTransport(day=10))
    again = run_target(
        conn, ch, settings, tid, now=day_timestamp(10) + timedelta(hours=1), transport=MockWebTransport(day=10)
    )
    assert later.events, "na 10 dagen moet er iets veranderd zijn"
    assert again.events == [] and again.stats["snapshots"] == 0

    # robots.txt: Shopify verbiedt sort_by — de crawler mag het dus nooit vragen
    assert not any("sort_by" in u for u in transport.requests)
    removed = [e.external_id for e in later.events if e.type == "product_removed"]
    if removed:
        status = conn.execute("SELECT status FROM products WHERE external_id = %s", (removed[0],)).fetchone()
        assert status == ("removed",)
    n = ch.query(
        "SELECT count() FROM change_events WHERE entity_id = {id:UInt64}", parameters={"id": store_id}
    ).result_rows[0][0]
    assert n == len(first.events) + len(later.events)


def test_sitemap_fallback_when_products_json_is_disabled(world):
    from trendscope.mockweb.transport import MockWebTransport, has_products_json
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    rows = conn.execute("SELECT id, target FROM crawl_targets ORDER BY id").fetchall()
    tid, domain = next(r for r in rows if not has_products_json(r[1]))
    transport = MockWebTransport(day=3)
    outcome = run_target(conn, ch, settings, tid, now=day_timestamp(3), transport=transport)
    assert outcome.stats["source"] == "sitemap"
    assert any(u.endswith(".json") and "/products/" in u for u in transport.requests)
    assert outcome.stats["products"] > 0


def test_failures_back_off_and_end_in_dead_letter(world):
    import httpx

    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    tid, _, _ = _target(conn, "t.id = (SELECT max(id) FROM crawl_targets WHERE connector_id = 'shopify_storefront')")

    def broken(request):
        raise httpx.ConnectError("down", request=request)

    for i in range(settings.crawl_max_failures):
        run_target(
            conn, ch, settings, tid, now=day_timestamp(4) + timedelta(hours=i), transport=httpx.MockTransport(broken)
        )
    failures, next_run = conn.execute(
        "SELECT failures, next_run_at FROM crawl_targets WHERE id = %s", (tid,)
    ).fetchone()
    dead = conn.execute(
        "SELECT dead_letter FROM crawl_jobs WHERE target_id = %s ORDER BY id DESC LIMIT 1", (tid,)
    ).fetchone()
    assert failures == settings.crawl_max_failures and dead == (True,)
    assert next_run >= day_timestamp(4) + timedelta(days=7)


def test_claim_due_skips_leased_targets(world):
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.due import claim_due

    conn, _, _ = world
    conn.execute("UPDATE crawl_targets SET next_run_at = %s, leased_until = NULL", (day_timestamp(0),))
    conn.commit()
    now = day_timestamp(1)
    a = claim_due(conn, now=now, limit=5, lease_minutes=30, production=False)
    b = claim_due(conn, now=now, limit=5, lease_minutes=30, production=False)
    assert len(a) == 5 and len(b) == 5 and not {t.id for t in a} & {t.id for t in b}
    # in productie draaien alleen juridisch goedgekeurde connectors
    assert claim_due(conn, now=now, limit=5, lease_minutes=30, production=True) == []


def test_discovery_finds_new_stores_and_rejects_non_shops(world):
    from trendscope.discovery.run import discover_and_probe
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp

    conn, _, settings = world
    found = discover_and_probe(conn, settings, now=day_timestamp(14), transport=MockWebTransport(day=14))
    assert found["accepted"] == 20 and found["rejected"] == 2
    platforms = dict(
        conn.execute("SELECT platform::text, count(*) FROM stores WHERE data_source = 'crawl' GROUP BY 1").fetchall()
    )
    assert platforms == {"shopify": 14, "woocommerce": 3, "magento": 1, "bigcommerce": 1, "wix": 1}
    targets = conn.execute(
        """SELECT count(*) FROM crawl_targets t JOIN stores s ON s.id = t.entity_id
           WHERE t.entity_type = 'store' AND t.connector_id = 'shopify_storefront' AND s.data_source = 'crawl'"""
    ).fetchone()
    assert targets == (14,), "alleen Shopify-winkels krijgen een storefront-crawl"
    again = discover_and_probe(conn, settings, now=day_timestamp(14), transport=MockWebTransport(day=14))
    assert again["accepted"] == 0, "bestaande winkels worden niet opnieuw kandidaat"


def test_redis_rate_limiter_spaces_requests_across_workers():
    redis = pytest.importorskip("redis")
    from trendscope.core.redis_ratelimit import RedisDomainRateLimiter

    r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    r.delete("test-rl:shop.example")
    waits: list[float] = []
    # twee 'workers' met dezelfde Redis delen de limiet
    a = RedisDomainRateLimiter(r, per_domain_rps=2, sleep=waits.append, prefix="test-rl")
    b = RedisDomainRateLimiter(r, per_domain_rps=2, sleep=waits.append, prefix="test-rl")
    a.acquire("shop.example")
    calls = {"n": 0}
    original = b._script

    def script(keys, args):
        calls["n"] += 1
        return original(keys=keys, args=args) if calls["n"] > 1 else 400

    b._script = script
    b.acquire("shop.example")
    assert waits and 0 < waits[0] <= 0.5
