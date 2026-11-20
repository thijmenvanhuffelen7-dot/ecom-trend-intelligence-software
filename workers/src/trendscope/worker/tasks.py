from __future__ import annotations

from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import psycopg
import redis

from trendscope.connectors.base import load_manifests
from trendscope.core.clickhouse import get_client
from trendscope.core.redis_ratelimit import RedisDomainRateLimiter
from trendscope.core.settings import get_settings
from trendscope.scheduler.due import claim_due
from trendscope.scheduler.runner import run_target
from trendscope.worker.celery_app import app


@lru_cache(maxsize=8)
def _limiter(connector_id: str) -> RedisDomainRateLimiter:
    """Eén gedeelde limiet per connector over álle workers (via Redis)."""
    limits = load_manifests()[connector_id].default_rate_limit
    return RedisDomainRateLimiter(
        redis.Redis.from_url(get_settings().redis_url),
        limits.per_domain_rps,
        limits.global_rps,
        prefix=f"ratelimit:{connector_id}",
    )


@app.task(name="trendscope.tick")
def tick() -> int:
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        targets = claim_due(
            conn,
            now=datetime.now(UTC),
            limit=settings.scheduler_batch,
            lease_minutes=settings.crawl_lease_minutes,
            production=settings.is_production,
        )
    for t in targets:
        crawl_target.apply_async(args=[t.id], priority=min(9, t.priority // 10))
    return len(targets)


@app.task(name="trendscope.crawl_target")
def crawl_target(target_id: int) -> dict[str, Any]:
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        connector_id = conn.execute("SELECT connector_id FROM crawl_targets WHERE id = %s", (target_id,)).fetchone()
        if connector_id is None:
            return {"status": "gone"}
        limiter = None if settings.data_mode == "mock" else _limiter(connector_id[0])
        outcome = run_target(conn, get_client(), settings, target_id, now=datetime.now(UTC), limiter=limiter)
    # Fouten zitten al in crawl_jobs (+ backoff/dead letter); Celery hoeft niet zelf te retryen
    return {"status": outcome.status if outcome else "failed", **(outcome.stats if outcome else {})}


@app.task(name="trendscope.discover")
def discover() -> dict[str, int]:
    from trendscope.discovery.run import discover_and_probe

    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        return dict(discover_and_probe(conn, settings, now=datetime.now(UTC)))


@app.task(name="trendscope.reindex_search")
def reindex_search() -> dict[str, int]:
    from trendscope.search.indexer import reindex_all

    return reindex_all()


@app.task(name="trendscope.screenshots")
def screenshots() -> dict[str, int]:
    from trendscope.media.screenshots import capture_store_screenshots

    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        return dict(capture_store_screenshots(conn, settings, now=datetime.now(UTC)))
