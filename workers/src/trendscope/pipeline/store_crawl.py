"""Crawl van één winkel: homepage → detectie → catalogus → diff → opslag.

Postgres bevat de *huidige* staat (producten, technologieën, winkelmeta); ClickHouse krijgt alleen
snapshots van gewijzigde producten en de change-events. Alles binnen één run gebruikt hetzelfde
tijdstip `now`, zodat een gesimuleerde of herhaalde run reproduceerbaar is.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from trendscope.connectors.shopify.connector import ShopifyProduct, fetch_bestsellers, fetch_catalog
from trendscope.core.http import PoliteHttpClient
from trendscope.detect.detector import Detection, detect
from trendscope.pipeline.diff import ChangeEvent, ProductState, VariantState, diff_catalog, diff_technologies
from trendscope.pipeline.matching import MATCH_SQL, MATCH_THRESHOLD, normalize_title

PLATFORMS = {"shopify", "woocommerce", "magento", "bigcommerce", "wix"}
TECH_TYPES = {"pixel", "app", "email", "reviews", "payment", "analytics"}


@dataclass
class CrawlOutcome:
    status: str  # succeeded | skipped
    items: int = 0
    events: list[ChangeEvent] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)


def _state_from_shopify(p: ShopifyProduct) -> ProductState:
    return ProductState(
        external_id=p.external_id,
        handle=p.handle,
        title=p.title,
        price=p.price,
        compare_at_price=p.compare_at_price,
        available=p.available,
        variants=tuple(VariantState(v.external_id, v.title, v.price, v.available) for v in p.variants),
        image=p.images[0] if p.images else None,
    )


def _state_from_row(row: dict[str, Any]) -> ProductState:
    return ProductState(
        external_id=row["external_id"],
        handle=row["handle"] or "",
        title=row["title"],
        price=row["price"],
        compare_at_price=row["compare_at_price"],
        available=row["available"],
        variants=tuple(
            VariantState(
                str(v["id"]), v.get("title", ""), Decimal(str(v.get("price", 0))), bool(v.get("available", True))
            )
            for v in row["variants"]
        ),
        image=row["image"],
    )


def sync_store_meta(conn: psycopg.Connection[Any], store_id: int, det: Detection, now: datetime) -> list[ChangeEvent]:
    """Werkt platform, metadata en technologieën bij. Geeft tech-events terug."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT type, name FROM store_technologies WHERE store_id = %s AND removed_at IS NULL AND type <> 'theme'",
            (store_id,),
        )
        existing = {r["name"]: r["type"] for r in cur.fetchall()}
        detected = {name: typ for typ, name in det.technologies if typ in TECH_TYPES}
        events = diff_technologies(set(existing), set(detected))
        for name, typ in detected.items():
            if name in existing and existing[name] != typ:
                # herclassificatie (bv. GA4 pixel → analytics): geen event, wel bijwerken
                cur.execute(
                    "DELETE FROM store_technologies WHERE store_id = %s AND name = %s AND type = %s",
                    (store_id, name, existing[name]),
                )
            cur.execute(
                """INSERT INTO store_technologies (store_id, type, name, detected_at) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (store_id, type, name) DO UPDATE SET removed_at = NULL""",
                (store_id, typ, name, now),
            )
        removed = [e.payload["name"] for e in events if e.type == "tech_removed"]
        if removed:
            cur.execute(
                "UPDATE store_technologies SET removed_at = %s WHERE store_id = %s AND name = ANY(%s) AND removed_at IS NULL",
                (now, store_id, removed),
            )
        cur.execute(
            """UPDATE stores SET
                 platform = %s::store_platform,
                 name = COALESCE(name, %s),
                 description = COALESCE(%s, description),
                 currency = COALESCE(%s, currency),
                 country = COALESCE(country, %s),
                 languages = CASE WHEN cardinality(%s::text[]) > 0 THEN %s::text[] ELSE languages END,
                 theme = COALESCE(%s, theme),
                 shopify_domain = COALESCE(%s, shopify_domain),
                 social = social || %s,
                 last_crawled = %s
               WHERE id = %s""",
            (
                det.platform if det.platform in PLATFORMS else "unknown",
                det.name,
                det.description,
                det.currency,
                det.country,
                det.languages,
                det.languages,
                det.theme,
                det.shopify_domain,
                Jsonb(det.social),
                now,
                store_id,
            ),
        )
    return events


def _match_cluster(cur: psycopg.Cursor[Any], title: str) -> int | None:
    normalized = normalize_title(title)
    if not normalized:
        return None
    cur.execute(MATCH_SQL, {"t": normalized})
    row = cur.fetchone()
    if row and float(row["score"]) >= MATCH_THRESHOLD:
        return int(row["id"])
    return None


def crawl_store(
    conn: psycopg.Connection[Any], ch: ClickHouse, client: PoliteHttpClient, store_id: int, domain: str, now: datetime
) -> CrawlOutcome:
    home = client.get(f"https://{domain}/")
    det = detect(home.text, dict(home.headers), home.cookies)
    with conn.transaction():
        tech_events = sync_store_meta(conn, store_id, det, now)
    if det.platform != "shopify":
        _write_events(ch, store_id, tech_events, now, {})
        return CrawlOutcome("skipped", events=tech_events, stats={"platform": det.platform, "reason": "geen Shopify"})

    catalog = fetch_catalog(client, domain)
    best = fetch_bestsellers(client, domain)

    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT id, external_id, handle, title, price, compare_at_price, available, variants, images[1] AS image,
                      content_hash, best_seller_rank
               FROM products WHERE store_id = %s AND source = 'shopify' AND status <> 'removed'""",
            (store_id,),
        )
        previous_rows = {r["external_id"]: r for r in cur.fetchall()}
        previous = {k: _state_from_row(r) for k, r in previous_rows.items()}
        current = {p.external_id: _state_from_shopify(p) for p in catalog.products}
        # Onvolledige catalogus (terugvalpad): wat we niet zagen is onbekend, niet verwijderd
        compare_to = current if catalog.complete else {**previous, **current}
        events = diff_catalog(previous, compare_to)

        snapshots: list[list[Any]] = []
        ids: dict[str, int] = {}
        new_ids: list[tuple[int, str]] = []
        for p in catalog.products:
            rank = (
                best.ranks.get(p.handle)
                if best.source
                else (previous_rows.get(p.external_id) or {}).get("best_seller_rank")
            )
            cur.execute(
                """INSERT INTO products (source, store_id, external_id, url, title, vendor, category, tags, images, price,
                     compare_at_price, currency, available, variants, published_at, handle, content_hash, best_seller_rank,
                     first_seen, last_seen, status, removed_at)
                   VALUES ('shopify', %(store)s, %(ext)s, %(url)s, %(title)s, %(vendor)s, %(cat)s, %(tags)s, %(images)s,
                     %(price)s, %(cmp)s, %(cur)s, %(avail)s, %(variants)s, %(pub)s, %(handle)s, %(hash)s, %(rank)s,
                     %(now)s, %(now)s, %(status)s, NULL)
                   ON CONFLICT (source, store_id, external_id) DO UPDATE SET
                     url = EXCLUDED.url, title = EXCLUDED.title, vendor = EXCLUDED.vendor, category = EXCLUDED.category,
                     tags = EXCLUDED.tags, images = EXCLUDED.images, price = EXCLUDED.price,
                     compare_at_price = EXCLUDED.compare_at_price, currency = EXCLUDED.currency,
                     available = EXCLUDED.available, variants = EXCLUDED.variants, handle = EXCLUDED.handle,
                     content_hash = EXCLUDED.content_hash, best_seller_rank = EXCLUDED.best_seller_rank,
                     last_seen = EXCLUDED.last_seen, status = EXCLUDED.status, removed_at = NULL
                   RETURNING id, (xmax = 0) AS inserted""",
                {
                    "store": store_id,
                    "ext": p.external_id,
                    "url": p.url,
                    "title": p.title,
                    "vendor": p.vendor,
                    "cat": p.product_type,
                    "tags": p.tags,
                    "images": p.images,
                    "price": p.price,
                    "cmp": p.compare_at_price,
                    "cur": det.currency,
                    "avail": p.available,
                    "pub": p.published_at,
                    "handle": p.handle,
                    "hash": p.content_hash,
                    "rank": rank,
                    "now": now,
                    "status": "active" if p.available else "out_of_stock",
                    "variants": Jsonb(
                        [
                            {"id": v.external_id, "title": v.title, "price": float(v.price), "available": v.available}
                            for v in p.variants
                        ]
                    ),
                },
            )
            row = cur.fetchone()
            assert row is not None
            ids[p.external_id] = row["id"]
            if row["inserted"]:
                new_ids.append((row["id"], p.title))
            if row["inserted"] or (previous_rows.get(p.external_id) or {}).get("content_hash") != p.content_hash:
                snapshots.append(
                    [
                        row["id"],
                        now,
                        p.price,
                        p.compare_at_price,
                        det.currency or "",
                        None,
                        None,
                        None,
                        None,
                        len(p.variants),
                        int(p.available),
                    ]
                )

        removed = [e.external_id for e in events if e.type == "product_removed"]
        if removed:
            cur.execute(
                """UPDATE products SET status = 'removed', removed_at = %s
                   WHERE store_id = %s AND source = 'shopify' AND external_id = ANY(%s)""",
                (now, store_id, removed),
            )
            for ext in removed:
                ids[ext] = previous_rows[ext]["id"]

        # Nieuwe producten koppelen aan bestaande productclusters (titel-trigram; embeddings in fase 4)
        matched = 0
        matched_clusters: set[int] = set()
        for pid, title in new_ids:
            cluster_id = _match_cluster(cur, title)
            if cluster_id is None:
                continue
            matched += 1
            cur.execute(
                "INSERT INTO cluster_members (cluster_id, product_id, confidence, method) VALUES (%s, %s, 0.8, 'title') ON CONFLICT DO NOTHING",
                (cluster_id, pid),
            )
            cur.execute(
                """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence, first_seen, last_seen)
                   VALUES ('store', %s, 'product_cluster', %s, 'sells', 0.8, %s, %s, %s)
                   ON CONFLICT (from_type, from_id, to_type, to_id, link_type) DO UPDATE SET last_seen = EXCLUDED.last_seen""",
                (store_id, cluster_id, Jsonb({"product_id": pid, "method": "title"}), now, now),
            )
            matched_clusters.add(cluster_id)

        # Gesorteerd bijwerken: parallelle crawls vergrendelen clusters zo in dezelfde volgorde (geen deadlocks)
        for cluster_id in sorted(matched_clusters):
            cur.execute(
                """UPDATE product_clusters SET store_count = (
                     SELECT count(DISTINCT p.store_id) FROM cluster_members m JOIN products p ON p.id = m.product_id
                     WHERE m.cluster_id = %s AND p.status <> 'removed') WHERE id = %s""",
                (cluster_id, cluster_id),
            )

        published = [p.published_at for p in catalog.products if p.published_at]
        cur.execute(
            """UPDATE stores SET
                 product_count = (SELECT count(*) FROM products WHERE store_id = %(id)s AND status <> 'removed'),
                 bestseller_source = COALESCE(%(best)s, bestseller_source),
                 launched_at = LEAST(launched_at, %(launch)s::date),
                 niche_id = COALESCE(niche_id, (
                   SELECT c.niche_id FROM cluster_members m JOIN products p ON p.id = m.product_id
                   JOIN product_clusters c ON c.id = m.cluster_id
                   WHERE p.store_id = %(id)s AND c.niche_id IS NOT NULL
                   GROUP BY c.niche_id ORDER BY count(*) DESC LIMIT 1)),
                 last_change_at = CASE WHEN %(changed)s THEN %(now)s ELSE last_change_at END
               WHERE id = %(id)s""",
            {
                "id": store_id,
                "best": best.source,
                "launch": min(published) if published else None,
                "changed": bool(events or tech_events),
                "now": now,
            },
        )

    if snapshots:
        ch.insert(
            "product_snapshots",
            snapshots,
            column_names=[
                "product_id",
                "captured_at",
                "price",
                "compare_at_price",
                "currency",
                "orders",
                "reviews_count",
                "rating",
                "stock",
                "variants_count",
                "available",
            ],
        )
    all_events = tech_events + events
    _write_events(ch, store_id, all_events, now, ids)
    _refresh_counters(conn, ch, store_id, now)
    return CrawlOutcome(
        "succeeded",
        items=len(catalog.products),
        events=all_events,
        stats={
            "platform": det.platform,
            "products": len(catalog.products),
            "source": catalog.source,
            "complete": catalog.complete,
            "bestsellers": best.source,
            "requests": catalog.requests + 1,
            "added": sum(e.type == "product_added" for e in events),
            "removed": len(removed),
            "price_changes": sum(e.type == "price_changed" for e in events),
            "snapshots": len(snapshots),
            "matched_to_clusters": matched,
            "tech_changes": len(tech_events),
        },
    )


def _write_events(ch: ClickHouse, store_id: int, events: list[ChangeEvent], now: datetime, ids: dict[str, int]) -> None:
    if not events:
        return
    rows = [
        [
            e.type,
            "store",
            store_id,
            now,
            json.dumps(e.payload | {"external_id": e.external_id, "product_id": ids.get(e.external_id)}),
        ]
        for e in events
    ]
    ch.insert("change_events", rows, column_names=["event_type", "entity_type", "entity_id", "occurred_at", "payload"])


def _refresh_counters(conn: psycopg.Connection[Any], ch: ClickHouse, store_id: int, now: datetime) -> None:
    since = now - timedelta(days=7)
    rows = ch.query(
        """SELECT event_type, count() FROM change_events
           WHERE entity_type = 'store' AND entity_id = {id:UInt64} AND occurred_at > {since:DateTime} AND occurred_at <= {now:DateTime}
           GROUP BY event_type""",
        parameters={"id": store_id, "since": since.replace(tzinfo=None), "now": now.replace(tzinfo=None)},
    ).result_rows
    counts = {str(k): int(v) for k, v in rows}
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE stores SET products_added_7d = %s, products_removed_7d = %s, price_changes_7d = %s WHERE id = %s",
            (
                counts.get("product_added", 0),
                counts.get("product_removed", 0),
                counts.get("price_changed", 0),
                store_id,
            ),
        )
    conn.commit()
