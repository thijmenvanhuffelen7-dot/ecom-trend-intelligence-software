"""Winkelscreenshots: homepage renderen (Playwright) → PNG → S3 → stores.screenshot_url."""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

import psycopg

from trendscope.connectors.base import load_manifests
from trendscope.core.clients import http_client_for
from trendscope.core.settings import Settings
from trendscope.media.capture import screenshot
from trendscope.media.storage import ensure_bucket, put_asset


def capture_store_screenshots(
    conn: psycopg.Connection[Any], settings: Settings, *, now: datetime, limit: int = 20, transport: Any = None
) -> Counter[str]:
    """Voor winkels zonder screenshot (de crawler vond ze zelf). Respecteert robots.txt van de homepage."""
    result: Counter[str] = Counter()
    rows = conn.execute(
        """SELECT id, domain FROM stores
           WHERE screenshot_url IS NULL AND data_source = 'crawl' AND platform <> 'unknown'
           ORDER BY first_seen DESC LIMIT %s""",
        (limit,),
    ).fetchall()
    if not rows:
        return result
    ensure_bucket()
    manifest = load_manifests()["store_probe"]
    with http_client_for(manifest, settings, transport=transport) as client:
        for store_id, domain in rows:
            url = f"https://{domain}/"
            try:
                if not client.is_allowed(url):
                    result["robots_disallowed"] += 1
                    continue
                # Mock-modus: de pagina komt van het nep-internet en wordt via Playwright-routing aangeboden
                html = client.get(url).text if settings.data_mode == "mock" else None
                png = screenshot(url, chrome_path=settings.chrome_path, route_html=html)
                asset = put_asset(png, "image/png", prefix="screenshots")
            except Exception as exc:  # noqa: BLE001 — één winkel mag de batch niet stoppen
                result["errors"] += 1
                print(f"screenshot {domain}: {type(exc).__name__}: {exc}")
                continue
            conn.execute(
                """INSERT INTO creative_assets (sha256, storage_key, content_type, bytes, width, height, source_url, fetched_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (sha256) DO NOTHING""",
                (asset.sha256, asset.key, asset.content_type, asset.bytes, asset.width, asset.height, url, now),
            )
            conn.execute("UPDATE stores SET screenshot_url = %s WHERE id = %s", (f"/api/media/{asset.key}", store_id))
            conn.commit()
            result["captured"] += 1
    return result
