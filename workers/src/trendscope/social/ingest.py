"""Social-targets uitvoeren: TikTok Shop (partner), creators/video's/livestreams, YouTube en Instagram.

Targets:
- tiktok_shop_partner  `cat:<niche>|<land>`  ontdekking: topproducten en -creators → nieuwe shop- en creator-targets
                       `shop:<shop_id>`      shop + producten (tellerstand "verkocht") → snapshots, GMV-schatting
                       `creator:<handle>`    profiel, recente video's (met productanker) en livestreams
- youtube_data         `q:<zoekterm>`        recente video's + kanalen
- instagram_business   `ig:<handle>`         publieke cijfers van zakelijke/creator-accounts
Elke GMV is een schatting met methode en betrouwbaarheid.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.types.json import Jsonb

from trendscope.clustering.engine import cluster_products, refresh_cluster
from trendscope.core.http import PoliteHttpClient
from trendscope.core.settings import Settings
from trendscope.marketplaces.ingest import _image
from trendscope.pipeline.matching import MATCH_SQL, MATCH_THRESHOLD, normalize_title
from trendscope.pipeline.store_crawl import CrawlOutcome
from trendscope.social import instagram, partner, youtube

SOCIAL_CONNECTORS = {"tiktok_shop_partner", "youtube_data", "instagram_business"}
CTR, CVR = 0.015, 0.03  # heuristiek voor video → aankoop (bewust laag; label "lage betrouwbaarheid")


def _cred(settings: Settings, value: str, name: str) -> str:
    if value:
        return value
    if settings.data_mode == "mock":
        return f"mock-{name.lower()}"
    raise RuntimeError(f"{name} ontbreekt")


def estimate(
    value: float, *, low: float, high: float, confidence: str, method: str, currency: str = "EUR"
) -> dict[str, Any]:
    return {
        "value": round(value, 2),
        "low": round(value * low, 2),
        "high": round(value * high, 2),
        "confidence": confidence,
        "method": method,
        "currency": currency,
    }


def _add_target(
    conn: psycopg.Connection[Any],
    connector: str,
    target: str,
    entity_type: str | None,
    entity_id: int | None,
    now: datetime,
    priority: int = 50,
) -> None:
    conn.execute(
        """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
           VALUES (%s, %s, %s, %s, %s, 86400, %s)
           ON CONFLICT (connector_id, target) DO NOTHING""",  # parallelle ontdekking kan hetzelfde target vinden
        (connector, target, entity_type, entity_id, priority, now),
    )


def hashtags_of(text: str) -> list[str]:
    return [t.strip().split()[0].lower() for t in text.split("#")[1:] if t.strip()][:10]


def _cluster_of_title(conn: psycopg.Connection[Any], title: str) -> int | None:
    norm = normalize_title(title)
    if not norm:
        return None
    row = conn.execute(MATCH_SQL, {"t": norm}).fetchone()
    # MATCH_SQL levert (id, score) of een dict-rij, afhankelijk van de cursor
    if row and float(row[1]) >= MATCH_THRESHOLD:
        return int(row[0])
    return None


# ── TikTok Shop ──────────────────────────────────────────────────────────────────────────────
def upsert_shop_products(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    shop_pk: int,
    items: list[partner.PShopProduct],
    now: datetime,
    *,
    store_images: bool,
) -> dict[str, int]:
    new_ids, snaps = [], []
    changed = 0
    for p in items:
        prev = conn.execute(
            "SELECT id, sold_count, image_phash FROM products WHERE source = 'tiktok_shop' AND external_id = %s AND store_id IS NULL",
            (p.product_id,),
        ).fetchone()
        phash, stored = (prev[2], None) if prev and prev[2] is not None else _image(client, p.image_url, store_images)
        images = [stored or p.image_url] if (stored or p.image_url) else []
        row = conn.execute(
            """INSERT INTO products (source, store_id, external_id, url, title, images, price, currency, tiktok_shop_id,
                 sold_count, commission_rate, image_phash, first_seen, last_seen, status)
               VALUES ('tiktok_shop', NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'active')
               ON CONFLICT (source, external_id) WHERE store_id IS NULL DO UPDATE SET
                 title = EXCLUDED.title, price = EXCLUDED.price, sold_count = EXCLUDED.sold_count,
                 commission_rate = EXCLUDED.commission_rate, last_seen = EXCLUDED.last_seen, status = 'active',
                 images = CASE WHEN products.images = '{}' THEN EXCLUDED.images ELSE products.images END,
                 image_phash = COALESCE(products.image_phash, EXCLUDED.image_phash)
               RETURNING id, (xmax = 0)""",
            (
                p.product_id,
                p.url,
                p.title,
                images,
                p.price,
                p.currency,
                shop_pk,
                p.sold_count,
                p.commission_rate,
                phash,
                now,
                now,
            ),
        ).fetchone()
        assert row is not None
        pid, is_new = int(row[0]), bool(row[1])
        if is_new:
            new_ids.append(pid)
        if is_new or (prev and prev[1] != p.sold_count):
            changed += 1
            snaps.append([pid, now, p.price, None, p.currency, p.sold_count, None, None, None, 1, 1])
    conn.commit()
    if snaps:
        ch.insert(
            "product_snapshots",
            snaps,
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
    stats = cluster_products(conn, now=now, product_ids=new_ids).as_dict() if new_ids else {}
    return {"products_new": len(new_ids), "sold_changed": changed, **{f"cluster_{k}": v for k, v in stats.items()}}


def refresh_shop_metrics(conn: psycopg.Connection[Any], ch: ClickHouse, shop_pk: int, now: datetime) -> None:
    """Verkopen 30d per product = tellerstand nu − 30 dagen geleden; GMV = Σ verkopen × prijs (schatting)."""
    rows = conn.execute("SELECT id, price FROM products WHERE tiktok_shop_id = %s ORDER BY id", (shop_pk,)).fetchall()
    if not rows:
        return
    ids = [int(r[0]) for r in rows]
    deltas = {
        int(r[0]): int(r[1])
        for r in ch.query(
            """SELECT product_id, toInt64(argMax(orders, captured_at)) - toInt64(argMin(orders, captured_at)) FROM product_snapshots
               WHERE product_id IN {ids:Array(UInt64)} AND captured_at >= {start:DateTime} AND orders IS NOT NULL
               GROUP BY product_id""",
            parameters={"ids": ids, "start": now - timedelta(days=30)},
        ).result_rows
    }
    units = gmv = 0.0
    with conn.cursor() as cur:
        for pid, price in rows:
            u = max(0, deltas.get(int(pid), 0))
            units += u
            gmv += u * float(price or 0)
            cur.execute("UPDATE products SET orders_30d = %s WHERE id = %s", (u, pid))
        cur.execute(
            """UPDATE tiktok_shops SET sold_30d = %s, gmv_30d = %s, last_crawled = %s,
                 product_count = (SELECT count(*) FROM products WHERE tiktok_shop_id = %s AND status <> 'removed')
               WHERE id = %s""",
            (
                int(units),
                Jsonb(
                    estimate(
                        gmv,
                        low=0.8,
                        high=1.15,
                        confidence="medium",
                        method="Δ verkochtteller × prijs (TikTok rondt tellers af)",
                    )
                ),
                now,
                shop_pk,
                shop_pk,
            ),
        )
    conn.commit()


def _upsert_shop(conn: psycopg.Connection[Any], s: partner.PShop, now: datetime) -> int:
    row = conn.execute(
        """INSERT INTO tiktok_shops (external_id, name, country, rating, followers, first_seen, last_crawled, store_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, (SELECT id FROM stores WHERE lower(name) = lower(%s) LIMIT 1))
           ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name, rating = EXCLUDED.rating,
             followers = EXCLUDED.followers, last_crawled = EXCLUDED.last_crawled
           RETURNING id""",
        (s.shop_id, s.name, s.country, s.rating, s.followers, now, now, s.name),
    ).fetchone()
    assert row is not None
    return int(row[0])


# ── Creators ─────────────────────────────────────────────────────────────────────────────────
def _upsert_creator(
    conn: psycopg.Connection[Any],
    platform: str,
    handle: str,
    *,
    name: str | None,
    followers: int | None,
    avatar: str | None,
    country: str | None,
    bio: str | None,
    contact: dict[str, Any] | None,
    external_id: str | None,
    now: datetime,
) -> int:
    row = conn.execute(
        """INSERT INTO creators (platform, handle, display_name, avatar_url, followers, country, bio, contact_public,
             external_id, first_seen, last_crawled)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (platform, handle) DO UPDATE SET display_name = EXCLUDED.display_name,
             avatar_url = COALESCE(EXCLUDED.avatar_url, creators.avatar_url), followers = EXCLUDED.followers,
             country = COALESCE(EXCLUDED.country, creators.country), bio = EXCLUDED.bio,
             contact_public = EXCLUDED.contact_public, external_id = COALESCE(EXCLUDED.external_id, creators.external_id),
             last_crawled = EXCLUDED.last_crawled
           RETURNING id""",
        (
            platform,
            handle,
            name,
            avatar,
            followers,
            country,
            bio,
            Jsonb(contact) if contact else None,
            external_id,
            now,
            now,
        ),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _follower_growth(ch: ClickHouse, creator_id: int, now: datetime, current: int) -> float | None:
    rows = ch.query(
        """SELECT argMin(followers, captured_at) FROM creator_snapshots
           WHERE creator_id = {c:UInt64} AND captured_at >= {start:DateTime}""",
        parameters={"c": creator_id, "start": now - timedelta(days=7)},
    ).result_rows
    base = rows[0][0] if rows and rows[0][0] else None
    return round((current / base - 1) * 100, 1) if base else None


def run_creator(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    base: str,
    key: str,
    handle: str,
    now: datetime,
    *,
    store_images: bool = False,
) -> dict[str, int]:
    c, vids, lives = partner.creator(client, base, key, handle)
    contact = {"business_email": c.business_email} if c.business_email else None
    cid = _upsert_creator(
        conn,
        "tiktok",
        c.handle,
        name=c.name,
        followers=c.followers,
        avatar=c.avatar_url,
        country=c.country,
        bio=c.bio,
        contact=contact,
        external_id=None,
        now=now,
    )
    anchors = {
        str(r[0]): (int(r[1]), int(r[2]) if r[2] else None, float(r[3] or 0))
        for r in conn.execute(
            """SELECT p.external_id, p.id, m.cluster_id, p.price FROM products p LEFT JOIN cluster_members m ON m.product_id = p.id
               WHERE p.source = 'tiktok_shop' AND p.external_id = ANY(%s)""",
            ([v.product_id for v in vids if v.product_id] + [pid for lv in lives for pid, _ in lv.products],),
        )
    }
    video_snaps, links = [], 0
    views_30d = views_total = 0
    clicks_value = 0.0
    with conn.cursor() as cur:
        for v in vids:
            product = anchors.get(v.product_id or "")
            cluster_id = product[1] if product else _cluster_of_title(conn, v.caption.split("#")[0])
            prev = cur.execute(
                "SELECT views, thumbnail_url FROM videos WHERE platform = 'tiktok' AND external_id = %s", (v.video_id,)
            ).fetchone()
            # Cover één keer kopiëren (in productie alleen na juridisch akkoord, zie STORE_MARKETPLACE_IMAGES)
            cover = prev[1] if prev and prev[1] else (_image(client, v.cover_url, store_images)[1] or v.cover_url)
            views_24h = v.views - int(prev[0]) if prev and prev[0] is not None else None
            cur.execute(
                """INSERT INTO videos (platform, external_id, creator_id, url, caption, hashtags, thumbnail_url, posted_at,
                     views, likes, comments, shares, views_24h, product_id, last_crawled)
                   VALUES ('tiktok', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (platform, external_id) DO UPDATE SET views = EXCLUDED.views, likes = EXCLUDED.likes,
                     comments = EXCLUDED.comments, shares = EXCLUDED.shares, thumbnail_url = EXCLUDED.thumbnail_url,
                     views_24h = COALESCE(EXCLUDED.views_24h, videos.views_24h), creator_id = EXCLUDED.creator_id,
                     product_id = EXCLUDED.product_id, last_crawled = EXCLUDED.last_crawled
                   RETURNING id""",
                (
                    v.video_id,
                    cid,
                    v.url,
                    v.caption,
                    hashtags_of(v.caption),
                    cover,
                    v.posted_at,
                    v.views,
                    v.likes,
                    v.comments,
                    v.shares,
                    views_24h,
                    product[0] if product else None,
                    now,
                ),
            )
            vid_row = cur.fetchone()
            assert vid_row is not None
            vid = int(vid_row[0])
            video_snaps.append([vid, now, v.views, v.likes, v.shares, v.comments])
            views_total += v.views
            if v.posted_at >= now - timedelta(days=30):
                views_30d += v.views
                if product:
                    clicks_value += v.views * CTR * CVR * product[2]
            if cluster_id:
                links += 1
                for from_type, from_id in (("video", vid), ("creator", cid)):
                    cur.execute(
                        """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence, first_seen, last_seen)
                           VALUES (%s, %s, 'product_cluster', %s, 'promotes', %s, %s, %s, %s)
                           ON CONFLICT (from_type, from_id, to_type, to_id, link_type) DO UPDATE SET last_seen = EXCLUDED.last_seen""",
                        (
                            from_type,
                            from_id,
                            cluster_id,
                            1.0 if product else 0.7,
                            Jsonb({"method": "product_anchor" if product else "caption_title"}),
                            now,
                            now,
                        ),
                    )
        live_value = 0.0
        for lv in lives:
            units = sum(u for _, u in lv.products)
            value = sum(u * anchors[pid][2] for pid, u in lv.products if pid in anchors)
            live_value += value if lv.started_at >= now - timedelta(days=30) else 0
            cur.execute(
                """INSERT INTO livestreams (external_id, creator_id, tiktok_shop_id, title, started_at, duration_min,
                     peak_viewers, total_viewers, units_sold, gmv, status)
                   VALUES (%s, %s, (SELECT tiktok_shop_id FROM products WHERE source = 'tiktok_shop' AND external_id = %s),
                     %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (external_id) DO UPDATE SET peak_viewers = EXCLUDED.peak_viewers,
                     total_viewers = EXCLUDED.total_viewers, units_sold = EXCLUDED.units_sold, gmv = EXCLUDED.gmv,
                     status = EXCLUDED.status
                   RETURNING id""",
                (
                    lv.live_id,
                    cid,
                    lv.products[0][0] if lv.products else None,
                    lv.title,
                    lv.started_at,
                    lv.duration_min,
                    lv.peak_viewers,
                    lv.total_viewers,
                    units,
                    Jsonb(
                        estimate(
                            value,
                            low=0.8,
                            high=1.2,
                            confidence="medium",
                            method="Δ verkochtteller tijdens de live × prijs",
                        )
                    ),
                    "live" if lv.started_at + timedelta(minutes=lv.duration_min) > now else "ended",
                ),
            )
            live_row = cur.fetchone()
            assert live_row is not None
            for pid, u in lv.products:
                if pid in anchors:
                    cur.execute(
                        """INSERT INTO livestream_products (livestream_id, product_id, units_sold) VALUES (%s, %s, %s)
                           ON CONFLICT (livestream_id, product_id) DO UPDATE SET units_sold = EXCLUDED.units_sold""",
                        (live_row[0], anchors[pid][0], u),
                    )
        recent = [v for v in vids if v.posted_at >= now - timedelta(days=30)]
        avg_views = int(sum(v.views for v in recent) / len(recent)) if recent else None
        engagement = (
            round(sum(v.likes + v.comments + v.shares for v in recent) / max(1, sum(v.views for v in recent)), 4)
            if recent
            else None
        )
        gmv = clicks_value + live_value
        cur.execute(
            """UPDATE creators SET avg_views = %s, engagement_rate = COALESCE(%s, engagement_rate), videos_count = %s,
                 followers_growth_7d = %s, niches = CASE WHEN niches = '{}' THEN %s ELSE niches END, gmv_30d = %s,
                 est_gmv = %s WHERE id = %s""",
            (
                avg_views,
                engagement,
                len(vids),
                _follower_growth(ch, cid, now, c.followers),
                sorted(
                    {
                        n
                        for (n,) in conn.execute(
                            """SELECT DISTINCT n.slug FROM entity_links l JOIN product_clusters pc ON pc.id = l.to_id
                    JOIN niches n ON n.id = pc.niche_id WHERE l.from_type = 'creator' AND l.from_id = %s""",
                            (cid,),
                        )
                    }
                ),
                Jsonb(
                    estimate(
                        gmv,
                        low=0.4,
                        high=2.0,
                        confidence="low",
                        method=f"views × CTR {CTR:.1%} × conversie {CVR:.0%} × prijs + live-verkopen",
                    )
                ),
                Jsonb(estimate(gmv, low=0.4, high=2.0, confidence="low", method="zie gmv_30d")),
                cid,
            ),
        )
    conn.commit()
    ch.insert(
        "creator_snapshots",
        [[cid, now, c.followers, avg_views]],
        column_names=["creator_id", "captured_at", "followers", "avg_views"],
    )
    if video_snaps:
        ch.insert(
            "video_snapshots",
            video_snaps,
            column_names=["video_id", "captured_at", "views", "likes", "shares", "comments"],
        )
    return {"videos": len(vids), "lives": len(lives), "video_links": links}


# ── YouTube en Instagram ─────────────────────────────────────────────────────────────────────
def run_youtube(
    conn: psycopg.Connection[Any], ch: ClickHouse, client: PoliteHttpClient, key: str, term: str, now: datetime
) -> dict[str, int]:
    ids = youtube.search_video_ids(client, key, term, now - timedelta(days=30))
    vids = youtube.videos(client, key, ids)
    chans = {c.channel_id: c for c in youtube.channels(client, key, sorted({v.channel_id for v in vids}))}
    linked = 0
    snaps = []
    for v in vids:
        ch_info = chans.get(v.channel_id)
        handle = ch_info.handle if ch_info and ch_info.handle else v.channel_id
        cid = _upsert_creator(
            conn,
            "youtube",
            handle,
            name=v.channel_title,
            followers=ch_info.subscribers if ch_info else None,
            avatar=ch_info.thumbnail if ch_info else None,
            country=ch_info.country if ch_info else None,
            bio=None,
            contact=None,
            external_id=v.channel_id,
            now=now,
        )
        row = conn.execute(
            """INSERT INTO videos (platform, external_id, creator_id, url, caption, thumbnail_url, posted_at, views, likes,
                 comments, last_crawled)
               VALUES ('youtube', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (platform, external_id) DO UPDATE SET views = EXCLUDED.views, likes = EXCLUDED.likes,
                 comments = EXCLUDED.comments, last_crawled = EXCLUDED.last_crawled
               RETURNING id""",
            (
                v.video_id,
                cid,
                f"https://www.youtube.com/watch?v={v.video_id}",
                v.title,
                v.thumbnail,
                v.published_at,
                v.views,
                v.likes,
                v.comments,
                now,
            ),
        ).fetchone()
        assert row is not None
        snaps.append([int(row[0]), now, v.views, v.likes, 0, v.comments])
        cluster_id = _cluster_of_title(conn, v.title)
        if cluster_id:
            linked += 1
            for from_type, from_id in (("video", int(row[0])), ("creator", cid)):
                conn.execute(
                    """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence, first_seen, last_seen)
                       VALUES (%s, %s, 'product_cluster', %s, 'promotes', 0.7, %s, %s, %s)
                       ON CONFLICT (from_type, from_id, to_type, to_id, link_type) DO UPDATE SET last_seen = EXCLUDED.last_seen""",
                    (from_type, from_id, cluster_id, Jsonb({"method": "title"}), now, now),
                )
    conn.commit()
    if snaps:
        ch.insert(
            "video_snapshots", snaps, column_names=["video_id", "captured_at", "views", "likes", "shares", "comments"]
        )
    return {"videos": len(vids), "channels": len(chans), "video_links": linked}


def run_instagram(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    settings: Settings,
    handle: str,
    now: datetime,
) -> dict[str, int]:
    prof = instagram.business_discovery(
        client,
        _cred(settings, settings.instagram_access_token, "INSTAGRAM_ACCESS_TOKEN"),
        _cred(settings, settings.instagram_user_id, "INSTAGRAM_USER_ID"),
        handle,
        settings.meta_graph_version,
    )
    cid = _upsert_creator(
        conn,
        "instagram",
        prof.username,
        name=prof.name,
        followers=prof.followers,
        avatar=prof.avatar,
        country=None,
        bio=None,
        contact=None,
        external_id=None,
        now=now,
    )
    conn.execute(
        "UPDATE creators SET engagement_rate = %s, videos_count = %s WHERE id = %s",
        (prof.engagement_rate, prof.media_count, cid),
    )
    conn.commit()
    ch.insert(
        "creator_snapshots",
        [[cid, now, prof.followers, None]],
        column_names=["creator_id", "captured_at", "followers", "avg_views"],
    )
    return {"media": len(prof.media)}


# ── Dispatch ─────────────────────────────────────────────────────────────────────────────────
def run_social_target(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    settings: Settings,
    target: dict[str, Any],
    now: datetime,
) -> CrawlOutcome:
    connector, raw = target["connector_id"], str(target["target"])
    if connector == "youtube_data":
        stats = run_youtube(
            conn, ch, client, _cred(settings, settings.youtube_api_key, "YOUTUBE_API_KEY"), raw.removeprefix("q:"), now
        )
        return CrawlOutcome("succeeded", items=stats["videos"], stats=stats)
    if connector == "instagram_business":
        stats = run_instagram(conn, ch, client, settings, raw.removeprefix("ig:"), now)
        return CrawlOutcome("succeeded", items=stats["media"], stats=stats)

    base = settings.tiktok_partner_base_url
    key = _cred(settings, settings.tiktok_partner_api_key, "TIKTOK_PARTNER_API_KEY")
    kind, _, arg = raw.partition(":")
    store_images = settings.data_mode == "mock" or settings.store_marketplace_images
    if kind == "cat":
        niche, _, country = arg.partition("|")
        products, handles = partner.category_top(client, base, key, niche, country or settings.trend_country)
        for shop_id in sorted({p.shop_id for p in products}):
            _add_target(conn, "tiktok_shop_partner", f"shop:{shop_id}", None, None, now)
        for h in handles:
            _add_target(conn, "tiktok_shop_partner", f"creator:{h}", None, None, now)
        conn.commit()
        return CrawlOutcome(
            "succeeded", items=len(products), stats={"discovered_products": len(products), "creators": len(handles)}
        )
    if kind == "shop":
        s = partner.shop(client, base, key, arg)
        shop_pk = _upsert_shop(conn, s, now)
        conn.commit()
        stats = upsert_shop_products(conn, ch, client, shop_pk, s.products, now, store_images=store_images)
        for attempt in range(3):  # parallelle crawls kunnen elkaar kruisen; Postgres breekt er één af → opnieuw
            try:
                refresh_shop_metrics(conn, ch, shop_pk, now)
                break
            except psycopg.errors.DeadlockDetected:
                conn.rollback()
                if attempt == 2:
                    raise
        touched = [
            int(r[0])
            for r in conn.execute(
                "SELECT DISTINCT m.cluster_id FROM cluster_members m JOIN products p ON p.id = m.product_id WHERE p.tiktok_shop_id = %s",
                (shop_pk,),
            )
        ]
        with conn.transaction(), conn.cursor() as cur:
            for cid in sorted(touched):
                refresh_cluster(cur, cid)
        return CrawlOutcome("succeeded", items=len(s.products), stats=stats)
    if kind == "creator":
        stats = run_creator(conn, ch, client, base, key, arg, now, store_images=store_images)
        return CrawlOutcome("succeeded", items=stats["videos"], stats=stats)
    raise ValueError(f"Onbekend target {raw}")
