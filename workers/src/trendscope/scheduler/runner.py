"""Voert één crawl-target uit: job registreren, connector draaien, planning en freshness bijwerken."""

from __future__ import annotations

import time
import traceback
from datetime import datetime, timedelta
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from trendscope.connectors.base import ConnectorNotPermitted, LegalReview, load_manifests
from trendscope.core.clients import http_client_for
from trendscope.core.http import RateLimiter
from trendscope.core.settings import Settings
from trendscope.pipeline.store_crawl import CrawlOutcome, crawl_store
from trendscope.scheduler.priority import compute_schedule


class UnknownConnector(Exception):
    pass


def run_target(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    settings: Settings,
    target_id: int,
    *,
    now: datetime,
    limiter: RateLimiter | None = None,
    transport: Any = None,
) -> CrawlOutcome | None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT t.*, s.monthly_visits, s.visits_growth, s.launched_at,
                      (s.products_added_7d + s.products_removed_7d + s.price_changes_7d) AS changes_7d,
                      (SELECT count(*) FROM watchlists w WHERE w.entity_type = 'store' AND w.entity_id = t.entity_id) AS watchers
               FROM crawl_targets t LEFT JOIN stores s ON s.id = t.entity_id WHERE t.id = %s""",
            (target_id,),
        )
        target = cur.fetchone()
        if target is None:
            return None
        cur.execute(
            "INSERT INTO crawl_jobs (connector_id, target, target_id, status, started_at, attempt) VALUES (%s, %s, %s, 'running', %s, %s) RETURNING id",
            (target["connector_id"], target["target"], target_id, now, target["failures"] + 1),
        )
        job_id = cur.fetchone()["id"]  # type: ignore[index]
    conn.commit()

    manifest = load_manifests().get(target["connector_id"])
    started = time.monotonic()
    outcome: CrawlOutcome | None = None
    error: str | None = None
    try:
        if manifest is None:
            raise UnknownConnector(target["connector_id"])
        if settings.is_production and manifest.legal_review != LegalReview.approved:
            raise ConnectorNotPermitted(f"{manifest.id}: legal_review={manifest.legal_review}")
        with http_client_for(manifest, settings, transport=transport, limiter=limiter) as client:
            if manifest.id == "shopify_storefront":
                outcome = crawl_store(conn, ch, client, int(target["entity_id"]), target["target"], now)
            else:
                raise UnknownConnector(manifest.id)
    except Exception as exc:  # noqa: BLE001 — elke fout moet in crawl_jobs belanden, niet de worker laten crashen
        conn.rollback()
        error = f"{type(exc).__name__}: {exc}"[:2000]
        traceback.print_exc()

    duration_ms = int((time.monotonic() - started) * 1000)
    failures = 0 if error is None else target["failures"] + 1
    dead = failures >= settings.crawl_max_failures
    age = (now.date() - target["launched_at"]).days if target["launched_at"] else None
    changes = (
        (outcome.stats.get("added", 0) + outcome.stats.get("removed", 0) + outcome.stats.get("price_changes", 0))
        if outcome
        else 0
    )
    schedule = compute_schedule(
        watchers=int(target["watchers"] or 0),
        monthly_visits=target["monthly_visits"],
        visits_growth=target["visits_growth"],
        changes_7d=int(target["changes_7d"] or 0) + changes,
        failures=failures,
        age_days=age,
    )
    next_run = now + (timedelta(days=7) if dead else timedelta(seconds=schedule.interval_secs))
    status = "failed" if error else (outcome.status if outcome else "failed")

    with conn.cursor() as cur:
        cur.execute(
            """UPDATE crawl_jobs SET status = %s, finished_at = %s, duration_ms = %s, items = %s, error = %s,
                 dead_letter = %s, stats = %s WHERE id = %s""",
            (
                status,
                now + timedelta(milliseconds=duration_ms),
                duration_ms,
                outcome.items if outcome else 0,
                error,
                dead,
                Jsonb(outcome.stats if outcome else {}),
                job_id,
            ),
        )
        cur.execute(
            """UPDATE crawl_targets SET last_run_at = %s, last_status = %s, failures = %s, next_run_at = %s,
                 priority = %s, interval_secs = %s, leased_until = NULL WHERE id = %s""",
            (now, status, failures, next_run, schedule.priority, schedule.interval_secs, target_id),
        )
        if error:
            cur.execute(
                "UPDATE connectors SET last_error_at = %s, last_error = %s, updated_at = %s WHERE id = %s",
                (now, error, now, target["connector_id"]),
            )
        else:
            cur.execute(
                "UPDATE connectors SET last_success_at = GREATEST(last_success_at, %s), updated_at = %s WHERE id = %s",
                (now, now, target["connector_id"]),
            )
    conn.commit()
    return outcome
