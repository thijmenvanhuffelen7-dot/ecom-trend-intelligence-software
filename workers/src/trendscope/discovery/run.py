"""Discovery: kandidaten verzamelen (CT-logs, ad-landingspagina's) en daarna proben."""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
import psycopg
from psycopg.types.json import Jsonb

from trendscope.connectors.base import load_manifests
from trendscope.core.clients import http_client_for
from trendscope.core.http import RobotsDisallowed
from trendscope.core.settings import Settings
from trendscope.detect.detector import detect
from trendscope.discovery.ct_logs import extract_domains, query_crtsh
from trendscope.pipeline.store_crawl import PLATFORMS, sync_store_meta

MAX_PROBE_ATTEMPTS = 3


def add_candidates(conn: psycopg.Connection[Any], domains: set[str], source: str, now: datetime) -> int:
    """Voegt alleen domeinen toe die nog geen winkel of kandidaat zijn."""
    if not domains:
        return 0
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO store_candidates (domain, source, discovered_at)
               SELECT d, %s, %s FROM unnest(%s::text[]) AS d
               WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.domain = d)
               ON CONFLICT (domain) DO NOTHING""",
            (source, now, sorted(domains)),
        )
        n = cur.rowcount
    conn.commit()
    return n


def collect_ct_logs(conn: psycopg.Connection[Any], settings: Settings, now: datetime, transport: Any = None) -> int:
    manifest = load_manifests()["ct_logs"]
    domains: set[str] = set()
    with http_client_for(manifest, settings, transport=transport) as client:
        for keyword in settings.discovery_keywords:
            try:
                domains |= extract_domains(query_crtsh(client, keyword))
            except (httpx.HTTPError, RobotsDisallowed, ValueError):
                continue
    return add_candidates(conn, domains, "ct_logs", now)


def collect_ad_landing_pages(conn: psycopg.Connection[Any], now: datetime) -> int:
    rows = conn.execute("SELECT DISTINCT landing_url FROM ads WHERE landing_url IS NOT NULL").fetchall()
    domains = {urlsplit(r[0]).netloc.lower().removeprefix("www.") for r in rows if r[0]}
    return add_candidates(conn, {d for d in domains if d}, "ads_landing", now)


def import_domains(conn: psycopg.Connection[Any], domains: list[str], now: datetime) -> int:
    clean = {
        d.strip().lower().removeprefix("https://").removeprefix("http://").removeprefix("www.").split("/")[0]
        for d in domains
    }
    return add_candidates(conn, {d for d in clean if "." in d}, "import", now)


def probe_candidates(
    conn: psycopg.Connection[Any], settings: Settings, now: datetime, *, limit: int = 100, transport: Any = None
) -> Counter[str]:
    """Homepage ophalen → platform herkennen → winkel + crawl-target aanmaken (of afwijzen)."""
    result: Counter[str] = Counter()
    candidates = conn.execute(
        "SELECT domain, source FROM store_candidates WHERE status = 'new' AND attempts < %s ORDER BY discovered_at LIMIT %s",
        (MAX_PROBE_ATTEMPTS, limit),
    ).fetchall()
    manifest = load_manifests()["store_probe"]
    with http_client_for(manifest, settings, transport=transport) as client:
        for domain, source in candidates:
            try:
                home = client.get(f"https://{domain}/")
                det = detect(home.text, dict(home.headers), home.cookies)
            except (httpx.HTTPError, RobotsDisallowed) as exc:
                conn.execute(
                    """UPDATE store_candidates SET attempts = attempts + 1, probed_at = %s,
                         status = CASE WHEN attempts + 1 >= %s THEN 'error' ELSE status END, evidence = %s WHERE domain = %s""",
                    (now, MAX_PROBE_ATTEMPTS, Jsonb({"error": f"{type(exc).__name__}: {exc}"[:300]}), domain),
                )
                conn.commit()
                result["errors"] += 1
                continue
            if det.platform not in PLATFORMS:
                conn.execute(
                    "UPDATE store_candidates SET status = 'rejected', probed_at = %s, attempts = attempts + 1, evidence = %s WHERE domain = %s",
                    (now, Jsonb({"platform": det.platform, "title": det.name}), domain),
                )
                conn.commit()
                result["rejected"] += 1
                continue
            with conn.transaction():
                row = conn.execute(
                    """INSERT INTO stores (domain, platform, name, data_source, first_seen, country, currency, languages)
                       VALUES (%s, %s::store_platform, %s, 'crawl', %s, %s, %s, %s)
                       ON CONFLICT (domain) DO UPDATE SET platform = EXCLUDED.platform RETURNING id""",
                    (domain, det.platform, det.name, now, det.country, det.currency, det.languages),
                ).fetchone()
                assert row is not None
                store_id = int(row[0])
                sync_store_meta(conn, store_id, det, now)
                if det.platform == "shopify":
                    # Nieuwe winkels krijgen voorrang: binnen het uur de eerste volledige crawl
                    conn.execute(
                        """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
                           VALUES ('shopify_storefront', %s, 'store', %s, 10, 21600, %s) ON CONFLICT (connector_id, target) DO NOTHING""",
                        (domain, store_id, now),
                    )
                conn.execute(
                    """UPDATE store_candidates SET status = 'accepted', probed_at = %s, attempts = attempts + 1, platform = %s::store_platform,
                         store_id = %s, evidence = %s WHERE domain = %s""",
                    (
                        now,
                        det.platform,
                        store_id,
                        Jsonb({"evidence": det.platform_evidence[:5], "source": source}),
                        domain,
                    ),
                )
            result["accepted"] += 1
    return result


def discover_and_probe(
    conn: psycopg.Connection[Any], settings: Settings, *, now: datetime, transport: Any = None
) -> Counter[str]:
    found: Counter[str] = Counter()
    found["candidates"] += collect_ct_logs(conn, settings, now, transport)
    found["candidates"] += collect_ad_landing_pages(conn, now)
    found.update(probe_candidates(conn, settings, now, transport=transport))
    with conn.cursor() as cur:
        cur.execute("UPDATE connectors SET last_success_at = %s WHERE id IN ('ct_logs', 'store_probe')", (now,))
    conn.commit()
    return found
