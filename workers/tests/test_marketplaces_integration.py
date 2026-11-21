"""Integratie: marktplaats-connectors → ingest → clustering → leveranciers, tegen Postgres + nep-internet.

RUN_INTEGRATION=1.
"""

import os
from collections import Counter, defaultdict

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
    from trendscope.mockweb.marketplace_world import reset_marketplace_caches
    from trendscope.mockweb.world import reset_caches
    from trendscope.seed.generate import run

    run()
    reset_caches()
    reset_marketplace_caches()
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        yield conn, get_client(), settings


def _run_all(world, day):
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    transport = MockWebTransport(day=day)
    ids = conn.execute(
        """SELECT id FROM crawl_targets
           WHERE connector_id IN ('aliexpress_affiliate', 'amazon_creators', 'cj_dropshipping') ORDER BY id"""
    ).fetchall()
    outcomes = [run_target(conn, ch, settings, tid, now=day_timestamp(day, 8), transport=transport) for (tid,) in ids]
    return outcomes, transport


def test_listings_cluster_with_the_right_product(world):
    from trendscope.mockweb import marketplace_world as mw

    conn, _, _ = world
    outcomes, transport = _run_all(world, 1)
    assert all(o.status == "succeeded" for o in outcomes), [o.error for o in outcomes if o.status != "succeeded"]
    # De sleutel gaat ondertekend mee, maar het geheim zelf nooit over de lijn
    assert not any("mock-aliexpress_app_secret" in u for u in transport.requests)

    rows = conn.execute(
        """SELECT p.external_id, m.cluster_id FROM products p
           JOIN cluster_members m ON m.product_id = p.id WHERE p.store_id IS NULL"""
    ).fetchall()
    per_item: dict[str, Counter[int]] = defaultdict(Counter)
    per_cluster: dict[int, set[str]] = defaultdict(set)
    for ext, cid in rows:
        key = mw.offers_by_id()[ext].item.key
        per_item[key][cid] += 1
        per_cluster[cid].add(key)
    assert all(len(items) == 1 for items in per_cluster.values()), "geen cluster mengt verschillende producten"
    split = [k for k, c in per_item.items() if len(c) > 1]
    assert not split, f"product over meerdere clusters verspreid: {split}"
    for key, clusters in per_item.items():
        if key.startswith("c"):
            assert int(key[1:]) in clusters, f"marktplaatslistings van seedcluster {key} horen bij dat cluster"

    # Producten die alleen op marktplaatsen bestaan krijgen een eigen, door de clustering gemaakt cluster
    new = conn.execute(
        "SELECT count(*) FROM product_clusters WHERE created_by = 'clustering' AND source_count >= 2"
    ).fetchone()[0]
    assert new >= len(mw.MARKET_ONLY) - 1


def test_supplier_offers_and_cluster_economics(world):
    conn, _, _ = world
    row = conn.execute(
        """SELECT count(*), count(DISTINCT o.supplier_id), min(o.price) FROM supplier_offers o
           JOIN products p ON p.id = o.product_id WHERE p.source IN ('aliexpress', 'cj')"""
    ).fetchone()
    assert row[0] > 100 and row[1] > 50 and row[2] > 0
    # Cluster met winkels én leveranciers: inkoop onder de winkelprijs, en de match is verklaard
    cl = conn.execute(
        """SELECT c.min_supplier_cost, c.min_price, c.source_count FROM product_clusters c
           WHERE c.created_by = 'seed' AND c.min_supplier_cost IS NOT NULL ORDER BY c.id LIMIT 1"""
    ).fetchone()
    assert cl is not None and cl[0] < cl[1] and cl[2] >= 2
    evidence = conn.execute(
        """SELECT m.evidence FROM cluster_members m JOIN products p ON p.id = m.product_id
           WHERE p.source = 'aliexpress' AND m.evidence <> '{}' LIMIT 1"""
    ).fetchone()[0]
    assert {"text", "image"} <= set(evidence)


def test_second_run_is_idempotent_and_detects_changes(world):
    conn, _, _ = world
    before = conn.execute("SELECT count(*) FROM products WHERE store_id IS NULL").fetchone()[0]
    clusters = conn.execute("SELECT count(*) FROM product_clusters").fetchone()[0]
    outcomes, _ = _run_all(world, 1)
    assert sum(o.stats.get("listing_new", 0) for o in outcomes) == 0
    assert conn.execute("SELECT count(*) FROM products WHERE store_id IS NULL").fetchone()[0] == before
    assert conn.execute("SELECT count(*) FROM product_clusters").fetchone()[0] == clusters
    # Weken later: verkopen en prijzen bewegen
    outcomes, _ = _run_all(world, 30)
    assert sum(o.stats.get("price_changed", 0) for o in outcomes) > 0


def test_merge_moves_everything_and_is_audited(world):
    from datetime import UTC, datetime

    from trendscope.clustering.engine import merge_clusters

    conn, _, _ = world
    keep, drop = conn.execute(
        "SELECT id FROM product_clusters WHERE created_by = 'seed' ORDER BY id LIMIT 2"
    ).fetchall()
    keep, drop = keep[0], drop[0]
    n_drop = conn.execute("SELECT count(*) FROM cluster_members WHERE cluster_id = %s", (drop,)).fetchone()[0]
    n_keep = conn.execute("SELECT count(*) FROM cluster_members WHERE cluster_id = %s", (keep,)).fetchone()[0]
    with conn.transaction(), conn.cursor() as cur:
        merge_clusters(cur, drop, keep, score=0.5, evidence={"test": True}, now=datetime.now(UTC))
        assert conn.execute("SELECT count(*) FROM product_clusters WHERE id = %s", (drop,)).fetchone()[0] == 0
        assert (
            conn.execute("SELECT count(*) FROM cluster_members WHERE cluster_id = %s", (keep,)).fetchone()[0]
            == n_keep + n_drop
        )
        assert (
            conn.execute(
                "SELECT count(*) FROM cluster_merges WHERE from_cluster = %s AND into_cluster = %s", (drop, keep)
            ).fetchone()[0]
            == 1
        )
        raise psycopg.Rollback()  # testdata niet blijvend wijzigen
