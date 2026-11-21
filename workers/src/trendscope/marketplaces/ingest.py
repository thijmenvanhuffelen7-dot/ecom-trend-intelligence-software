"""Marktplaatslistings verwerken: upsert, snapshots, beeldhash, clustering en leveranciersaanbiedingen."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from trendscope.clustering.embed import default_embedder, to_pgvector
from trendscope.clustering.engine import cluster_products, refresh_cluster
from trendscope.clustering.phash import phash_bytes
from trendscope.core.http import PoliteHttpClient
from trendscope.marketplaces.amazon import estimate_monthly_sales
from trendscope.marketplaces.records import Listing

SUPPLIER_NAMES = {"cj": "CJ Dropshipping"}


@dataclass
class MarketplaceOutcome:
    listings: int = 0
    events: Counter[str] = field(default_factory=Counter)
    cluster_stats: dict[str, int] = field(default_factory=dict)

    def stats(self) -> dict[str, Any]:
        return {
            "listings": self.listings,
            **dict(self.events),
            **{f"cluster_{k}": v for k, v in self.cluster_stats.items()},
        }


def _image(client: PoliteHttpClient, url: str | None, store_images: bool) -> tuple[int | None, str | None]:
    """pHash van de hoofdafbeelding (+ optioneel een kopie in S3 voor weergave)."""
    if not url or not url.startswith("http"):
        return None, None
    try:
        res = client.get(url)
        phash = phash_bytes(res.content)
    except Exception:  # noqa: BLE001 — een kapotte afbeelding mag de listing niet blokkeren
        return None, None
    if not store_images:
        return phash, None
    from trendscope.media.storage import ensure_bucket, put_asset

    try:
        ensure_bucket()
        asset = put_asset(res.content, res.headers.get("content-type", "image/png"), prefix="products")
        return phash, f"/api/media/{asset.key}"
    except Exception:  # noqa: BLE001
        return phash, None


def ingest_listings(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    listings: list[Listing],
    *,
    now: datetime,
    store_images: bool,
) -> MarketplaceOutcome:
    out = MarketplaceOutcome(listings=len(listings))
    snapshots: list[list[Any]] = []
    changed_ids: list[int] = []
    pids: dict[tuple[str, str], int] = {}
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        for li in listings:
            cur.execute(
                "SELECT id, content_hash, image_phash, images, price FROM products WHERE source = %s AND external_id = %s AND store_id IS NULL",
                (li.source, li.external_id),
            )
            prev = cur.fetchone()
            phash, stored_url = (
                (prev["image_phash"], None)
                if prev and prev["image_phash"] is not None
                else _image(client, li.image_url, store_images)
            )
            images = [stored_url or li.image_url] if (stored_url or li.image_url) else []
            if prev and prev["images"] and not stored_url:
                images = prev["images"]
            est = estimate_monthly_sales(li.sales_rank, li.sales_rank_category) if li.source == "amazon" else None
            values = {
                "source": li.source,
                "ext": li.external_id,
                "url": li.url,
                "title": li.title,
                "price": li.price,
                "cur": li.currency,
                "images": images,
                "tags": li.tags,
                "cat": li.category,
                "orders": li.orders_30d,
                "rating": li.rating,
                "reviews": li.reviews_count,
                "rank": li.sales_rank,
                "rank_cat": li.sales_rank_category,
                "est": Jsonb(est) if est else None,
                "seller_id": li.seller_id,
                "seller": li.seller_name,
                "ship": li.shipping_cost,
                "days": f"[{li.shipping_days[0]},{li.shipping_days[1]}]" if li.shipping_days else None,
                "from": li.ships_from,
                "hash": li.content_hash,
                "phash": phash,
                "now": now,
                "cmp": li.original_price,
                "emb": to_pgvector(default_embedder.embed(li.title)),
            }
            if prev is None:
                cur.execute(
                    """INSERT INTO products (source, store_id, external_id, url, title, price, currency, images, tags, category,
                         orders_30d, rating, reviews_count, sales_rank, sales_rank_category, est_monthly_sales, seller_id,
                         seller_name, shipping_cost, shipping_days, ships_from, content_hash, image_phash, compare_at_price,
                         embedding, first_seen, last_seen)
                       VALUES (%(source)s, NULL, %(ext)s, %(url)s, %(title)s, %(price)s, %(cur)s, %(images)s, %(tags)s, %(cat)s,
                         %(orders)s, %(rating)s, %(reviews)s, %(rank)s, %(rank_cat)s, %(est)s, %(seller_id)s, %(seller)s,
                         %(ship)s, %(days)s::int4range, %(from)s, %(hash)s, %(phash)s, %(cmp)s, %(emb)s::vector, %(now)s, %(now)s)
                       RETURNING id""",
                    values,
                )
                out.events["listing_new"] += 1
            else:
                cur.execute(
                    """UPDATE products SET url = %(url)s, title = %(title)s, price = %(price)s, currency = %(cur)s,
                         images = %(images)s, category = %(cat)s, orders_30d = %(orders)s, rating = %(rating)s,
                         reviews_count = %(reviews)s, sales_rank = %(rank)s, sales_rank_category = %(rank_cat)s,
                         est_monthly_sales = %(est)s, seller_name = %(seller)s,
                         shipping_cost = COALESCE(%(ship)s, shipping_cost), shipping_days = COALESCE(%(days)s::int4range, shipping_days),
                         content_hash = %(hash)s, image_phash = COALESCE(image_phash, %(phash)s), last_seen = %(now)s, status = 'active'
                       WHERE id = %(id)s RETURNING id""",
                    values | {"id": prev["id"]},
                )
                if prev["price"] is not None and li.price is not None and abs(prev["price"] - li.price) > 0.005:
                    out.events["price_changed"] += 1
            row = cur.fetchone()
            assert row is not None
            pid = int(row["id"])
            if prev is None or prev["content_hash"] != li.content_hash:
                snapshots.append(
                    [
                        pid,
                        now,
                        li.price,
                        li.original_price,
                        li.currency,
                        li.orders_30d,
                        li.reviews_count,
                        li.rating,
                        None,
                        1,
                        1,
                    ]
                )
                changed_ids.append(pid)
            pids[(li.source, li.external_id)] = pid

    # Clusteren: nieuwe listings koppelen of samen een nieuw cluster vormen
    new_ids = list(pids.values())
    stats = cluster_products(conn, now=now, product_ids=new_ids)
    out.cluster_stats = stats.as_dict()

    # Leveranciersaanbiedingen voor listings die nu in een cluster zitten
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        touched: set[int] = set()
        for li in listings:
            if not li.is_supplier:
                continue
            pid = pids[(li.source, li.external_id)]
            cur.execute("SELECT cluster_id FROM cluster_members WHERE product_id = %s", (pid,))
            m = cur.fetchone()
            if not m:
                continue
            seller_id = li.seller_id or li.source
            cur.execute(
                """INSERT INTO suppliers (source, external_id, name, rating, url, store_url, positive_rate)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (source, external_id) DO UPDATE SET rating = COALESCE(EXCLUDED.rating, suppliers.rating),
                     positive_rate = COALESCE(EXCLUDED.positive_rate, suppliers.positive_rate)
                   RETURNING id""",
                (
                    li.source,
                    seller_id,
                    li.seller_name or SUPPLIER_NAMES.get(li.source) or f"AliExpress-winkel {seller_id}",
                    li.rating,
                    li.seller_url,
                    li.seller_url,
                    li.seller_positive_rate,
                ),
            )
            sup = cur.fetchone()
            assert sup is not None
            cur.execute(
                """INSERT INTO supplier_offers (supplier_id, cluster_id, product_id, url, price, shipping_cost, shipping_days, currency, orders, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s::int4range, %s, %s, %s)
                   ON CONFLICT (product_id) WHERE product_id IS NOT NULL DO UPDATE SET
                     cluster_id = EXCLUDED.cluster_id, price = EXCLUDED.price, shipping_cost = EXCLUDED.shipping_cost,
                     shipping_days = COALESCE(EXCLUDED.shipping_days, supplier_offers.shipping_days), orders = EXCLUDED.orders,
                     updated_at = EXCLUDED.updated_at""",
                (
                    sup["id"],
                    m["cluster_id"],
                    pid,
                    li.url,
                    li.price or 0,
                    li.shipping_cost or 0,
                    f"[{li.shipping_days[0]},{li.shipping_days[1] + 1})" if li.shipping_days else None,
                    li.currency,
                    li.orders_30d,
                    now,
                ),
            )
            touched.add(int(m["cluster_id"]))
        for cid in sorted(touched):
            refresh_cluster(cur, cid)

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
    return out
