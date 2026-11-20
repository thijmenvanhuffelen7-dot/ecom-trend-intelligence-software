"""Integratie: ad-connectors → ingest → koppeling, tegen Postgres + ClickHouse + nep-internet. RUN_INTEGRATION=1."""

import os

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
    from trendscope.mockweb.ads_world import reset_ads_caches
    from trendscope.mockweb.world import reset_caches
    from trendscope.seed.generate import run

    run()
    reset_caches()
    reset_ads_caches()
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        yield conn, get_client(), settings


def _run(world, target, day, hour=9):
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    tid = conn.execute("SELECT id FROM crawl_targets WHERE target = %s", (target,)).fetchone()[0]
    transport = MockWebTransport(day=day)
    return run_target(conn, ch, settings, tid, now=day_timestamp(day, hour), transport=transport), transport


def test_meta_page_is_idempotent_at_day0_and_tracks_changes(world):
    conn, _, _ = world
    page = conn.execute("SELECT target FROM crawl_targets WHERE target LIKE 'page:%' ORDER BY id LIMIT 1").fetchone()[0]
    first, transport = _run(world, page, 0)
    assert first.stats.get("ad_started", 0) == 0, "dag 0 = exact de seed: geen 'nieuwe' ads"
    # het token gaat mee in de request, maar wordt nooit opgeslagen
    assert any("access_token=" in u for u in transport.requests)
    leaked = conn.execute("SELECT count(*) FROM ads WHERE snapshot_url LIKE '%access_token%'").fetchone()[0]
    assert leaked == 0

    later, _ = _run(world, page, 10)
    assert later.stats.get("ad_started", 0) > 0
    new = conn.execute(
        """SELECT a.media, a.format, a.cta, a.landing_domain, a.est_reach FROM ads a
           JOIN advertisers v ON v.id = a.advertiser_id WHERE v.external_id = %s AND a.external_id LIKE '95%%'""",
        (page.removeprefix("page:"),),
    ).fetchall()
    assert new and all(m for m, *_ in new), "media/formaat/CTA uit de snapshot gehaald"
    assert all(r[3] for r in new) and all(r[4]["confidence"] == "high" for r in new)
    linked = conn.execute(
        """SELECT count(*) FROM entity_links l JOIN ads a ON a.id = l.from_id
           JOIN advertisers v ON v.id = a.advertiser_id WHERE l.from_type = 'ad' AND v.external_id = %s""",
        (page.removeprefix("page:"),),
    ).fetchone()[0]
    assert linked >= len(new), "nieuwe ads gekoppeld aan productclusters"
    methods = {
        r[0]
        for r in conn.execute(
            """SELECT l.evidence->>'method' FROM entity_links l JOIN ads a ON a.id = l.from_id JOIN advertisers v ON v.id = a.advertiser_id
           WHERE l.from_type = 'ad' AND v.external_id = %s AND a.external_id LIKE '95%%'""",
            (page.removeprefix("page:"),),
        ).fetchall()
    }
    assert "landing_page" in methods, "na snapshot-capture is de landingspagina het bewijs"
    assert later.stats["relinked"] > 0


def test_keyword_search_discovers_new_advertisers(world):
    conn, _, _ = world
    before = conn.execute("SELECT count(*) FROM crawl_targets WHERE target LIKE 'page:%'").fetchone()[0]
    outcome, _ = _run(world, "q:posture", 12)
    after = conn.execute("SELECT count(*) FROM crawl_targets WHERE target LIKE 'page:%'").fetchone()[0]
    assert outcome.stats["ads"] > 0
    assert after - before == outcome.stats["new_targets"]
    if outcome.stats["new_candidates"]:
        assert conn.execute("SELECT count(*) FROM store_candidates WHERE source = 'ads_landing'").fetchone()[0] > 0


def test_tiktok_and_google_ingest(world):
    conn, _, _ = world
    tt, transport = _run(world, "q:skincare|NL", 10)
    assert tt.status == "succeeded" and tt.stats["ads"] > 0
    assert any("/oauth/token/" in u for u in transport.requests)
    media = conn.execute("SELECT media FROM ads WHERE platform = 'tiktok' LIMIT 1").fetchone()[0]
    assert media and media[0]["type"] == "video"
    linked = conn.execute(
        "SELECT count(*) FROM advertisers WHERE platform = 'tiktok' AND store_id IS NOT NULL"
    ).fetchone()[0]
    assert linked > 0, "TikTok-adverteerders gekoppeld aan winkels op naam"

    g = conn.execute(
        "SELECT target FROM crawl_targets WHERE connector_id = 'google_ads_transparency' LIMIT 1"
    ).fetchone()[0]
    go, _ = _run(world, g, 10)
    assert go.stats["ads"] > 0
    imp = conn.execute("SELECT impressions_high, est_reach FROM ads WHERE platform = 'google' LIMIT 1").fetchone()
    assert imp[0] and imp[1]["confidence"] == "medium"


def test_missing_credentials_fail_cleanly_in_live_mode(world):
    from trendscope.core.settings import Settings
    from trendscope.mockweb.transport import MockWebTransport
    from trendscope.mockweb.world import day_timestamp
    from trendscope.scheduler.runner import run_target

    conn, ch, settings = world
    live = Settings(**(settings.model_dump() | {"data_mode": "live", "meta_ad_library_access_token": ""}))
    tid = conn.execute("SELECT id FROM crawl_targets WHERE target LIKE 'page:%' ORDER BY id DESC LIMIT 1").fetchone()[0]
    assert run_target(conn, ch, live, tid, now=day_timestamp(13), transport=MockWebTransport(day=13)) is None
    err = conn.execute("SELECT error FROM crawl_jobs WHERE target_id = %s ORDER BY id DESC LIMIT 1", (tid,)).fetchone()[
        0
    ]
    assert "META_AD_LIBRARY_ACCESS_TOKEN" in err


def test_s3_roundtrip_and_screenshot():
    from trendscope.core.settings import get_settings
    from trendscope.media.storage import ensure_bucket, put_asset, s3_client

    try:
        ensure_bucket()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"geen S3 bereikbaar: {exc}")
    png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (2).to_bytes(4, "big") + (3).to_bytes(4, "big") + b"rest"
    a = put_asset(png, "image/png")
    b = put_asset(png, "image/png")
    assert a.key == b.key and a.key.startswith("creatives/") and (a.width, a.height) == (2, 3)
    assert s3_client().get_object(Bucket=get_settings().s3_bucket, Key=a.key)["Body"].read() == png

    chrome = get_settings().chrome_path
    if not chrome:
        pytest.skip("CHROME_PATH niet gezet")
    from trendscope.media.capture import screenshot

    shot = screenshot("https://shop.example/", chrome_path=chrome, width=320, height=200, route_html="<h1>Hallo</h1>")
    assert shot[:8] == b"\x89PNG\r\n\x1a\n"
