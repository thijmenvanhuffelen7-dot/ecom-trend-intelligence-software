"""Ad-targets uitvoeren. Targetformaten per connector:

- meta_ad_library:           page:<page_id>  (adverteerder volgen)  |  q:<zoekterm>  (nieuwe adverteerders vinden)
- tiktok_commercial_content: biz:<business_id>                      |  q:<zoekterm>|<landcode>
- google_ads_transparency:   adv:<advertiser_id>
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.types.json import Jsonb

from trendscope.ads import google, meta, tiktok
from trendscope.ads.ingest import ingest_ads, relink_by_landing_page
from trendscope.ads.records import AdRecord
from trendscope.core.http import PoliteHttpClient
from trendscope.core.settings import Settings
from trendscope.media.capture import fetch_meta_snapshot
from trendscope.pipeline.store_crawl import CrawlOutcome

AD_CONNECTORS = {"meta_ad_library", "tiktok_commercial_content", "google_ads_transparency"}
MAX_SNAPSHOT_CAPTURES = 40


class MissingCredentials(Exception):
    pass


def _since(target: dict[str, Any], today: date, settings: Settings) -> date:
    last = target.get("last_run_at")
    return (last.date() - timedelta(days=2)) if last else today - timedelta(days=settings.ads_lookback_days)


def _mock_token(settings: Settings, value: str) -> str:
    return value or ("mock-token" if settings.data_mode == "mock" else "")


def fetch_records(client: PoliteHttpClient, settings: Settings, target: dict[str, Any], today: date) -> list[AdRecord]:
    connector, spec = target["connector_id"], target["target"]
    kind, _, value = spec.partition(":")
    since = _since(target, today, settings)
    if connector == "meta_ad_library":
        token = _mock_token(settings, settings.meta_ad_library_access_token)
        if not token:
            raise MissingCredentials("META_AD_LIBRARY_ACCESS_TOKEN ontbreekt")
        if kind == "page":
            return list(
                meta.fetch_ads(
                    client,
                    token=token,
                    version=settings.meta_graph_version,
                    today=today,
                    page_ids=[value],
                    countries=settings.meta_countries,
                    since=since,
                )
            )
        return list(
            meta.fetch_ads(
                client,
                token=token,
                version=settings.meta_graph_version,
                today=today,
                search_terms=value,
                countries=settings.meta_countries,
                active_status="ACTIVE",
                since=since,
            )
        )
    if connector == "tiktok_commercial_content":
        key = _mock_token(settings, settings.tiktok_client_key)
        secret = _mock_token(settings, settings.tiktok_client_secret)
        if not key or not secret:
            raise MissingCredentials("TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET ontbreken")
        token = tiktok.get_token(client, key, secret)
        if kind == "biz":
            records: list[AdRecord] = []
            for country in settings.tiktok_countries:
                records += tiktok.fetch_ads(
                    client, token=token, today=today, since=since, country=country, business_ids=[value]
                )
            return _merge_countries(records)
        term, _, country = value.partition("|")
        return list(
            tiktok.fetch_ads(client, token=token, today=today, since=since, country=country or "NL", search_term=term)
        )
    if connector == "google_ads_transparency":
        if settings.data_mode == "mock":
            from trendscope.mockweb.ads_world import day_date, google_rows
            from trendscope.mockweb.world import current_day

            day = (today - day_date(0)).days if today else current_day()
            rows = google_rows([value], since, day)
        else:  # pragma: no cover - live BigQuery
            rows = google.query_bigquery([value], since)
        return list(google.parse_rows(rows, today))
    raise ValueError(f"Onbekende ad-connector {connector}")


def _merge_countries(records: list[AdRecord]) -> list[AdRecord]:
    """TikTok levert per land; één ad die in meerdere landen draait wordt één record."""
    merged: dict[str, AdRecord] = {}
    for r in records:
        if r.external_id in merged:
            merged[r.external_id].countries = sorted(set(merged[r.external_id].countries) | set(r.countries))
        else:
            merged[r.external_id] = r
    return list(merged.values())


def run_ads_target(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    settings: Settings,
    target: dict[str, Any],
    now: datetime,
) -> CrawlOutcome:
    today = now.date()
    records = fetch_records(client, settings, target, today)
    outcome = ingest_ads(conn, ch, records, connector_id=target["connector_id"], now=now, today=today)

    # Nieuwe adverteerders (via zoektermen gevonden) krijgen een eigen volg-target
    prefix = {"meta_ad_library": "page", "tiktok_commercial_content": "biz", "google_ads_transparency": "adv"}[
        target["connector_id"]
    ]
    new_targets = 0
    with conn.cursor() as cur:
        for adv_ext in {r.advertiser_external_id for r in records}:
            cur.execute(
                """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
                   SELECT %s, %s, 'advertiser', a.id, 30, 86400, %s FROM advertisers a
                   WHERE a.platform = %s AND a.external_id = %s
                   ON CONFLICT (connector_id, target) DO NOTHING""",
                (
                    target["connector_id"],
                    f"{prefix}:{adv_ext}",
                    now + timedelta(hours=1),
                    {"page": "meta", "biz": "tiktok", "adv": "google"}[prefix],
                    adv_ext,
                ),
            )
            new_targets += cur.rowcount
    conn.commit()

    # Meta levert geen media: haal formaat, beeld/video en CTA uit de snapshot van nieuwe ads
    captured = 0
    if target["connector_id"] == "meta_ad_library" and (settings.data_mode == "mock" or settings.meta_snapshot_capture):
        token = _mock_token(settings, settings.meta_ad_library_access_token)
        rows = conn.execute(
            "SELECT id, snapshot_url FROM ads WHERE id = ANY(%s) AND snapshot_url IS NOT NULL AND jsonb_array_length(media) = 0 LIMIT %s",
            (outcome.new_ad_ids, MAX_SNAPSHOT_CAPTURES),
        ).fetchall()
        for ad_id, snapshot_url in rows:
            try:
                creative = fetch_meta_snapshot(client, snapshot_url, token)
            except Exception:  # noqa: BLE001 — één mislukte snapshot mag de run niet breken
                continue
            if creative.media or creative.cta:
                conn.execute(
                    """UPDATE ads SET media = %s, format = COALESCE(%s, format), cta = COALESCE(%s, cta),
                         landing_url = COALESCE(landing_url, %s), thumbnail_url = %s, media_urls = %s WHERE id = %s""",
                    (
                        Jsonb(creative.media),
                        creative.format,
                        creative.cta,
                        creative.landing_url,
                        next((m.get("poster") or m["url"] for m in creative.media), None),
                        [m["url"] for m in creative.media],
                        ad_id,
                    ),
                )
                captured += 1
        conn.commit()
        relinked = relink_by_landing_page(conn, [r[0] for r in rows], now)
    else:
        relinked = 0
    return CrawlOutcome(
        "succeeded",
        items=len(records),
        stats=outcome.stats() | {"new_targets": new_targets, "snapshots_captured": captured, "relinked": relinked},
    )
