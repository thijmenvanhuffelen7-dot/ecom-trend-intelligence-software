"""Ads verwerken: upsert, events, snapshots, varianten, schattingen en koppeling aan winkels/producten."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from trendscope.ads.estimates import estimate_reach, estimate_spend
from trendscope.ads.records import AdRecord
from trendscope.pipeline.matching import MATCH_SQL, normalize_title

TEXT_MATCH_THRESHOLD = 0.5  # strenger dan bij productmatching: ad-teksten zijn rommeliger dan titels
NAME_MATCH_THRESHOLD = 0.8  # adverteerdernaam ↔ winkelnaam: alleen bij (vrijwel) exacte overeenkomst


@dataclass
class IngestOutcome:
    ads: int = 0
    events: Counter[str] = field(default_factory=Counter)
    linked_stores: int = 0
    linked_products: int = 0
    new_candidates: int = 0
    new_ad_ids: list[int] = field(default_factory=list)

    def stats(self) -> dict[str, Any]:
        return {
            "ads": self.ads,
            **dict(self.events),
            "linked_stores": self.linked_stores,
            "linked_products": self.linked_products,
            "new_candidates": self.new_candidates,
        }


def _store_for_domain(cur: psycopg.Cursor[Any], domain: str | None, cache: dict[str, int | None]) -> int | None:
    if not domain:
        return None
    if domain not in cache:
        cur.execute(
            "SELECT id FROM stores WHERE domain = %s OR %s LIKE '%%.' || domain ORDER BY length(domain) DESC LIMIT 1",
            (domain, domain),
        )
        row = cur.fetchone()
        cache[domain] = int(row["id"]) if row else None
    return cache[domain]


def _cluster_for_ad(cur: psycopg.Cursor[Any], ad: AdRecord, store_id: int | None) -> tuple[int, str] | None:
    """Eerst exact via /products/<handle> op de landingspagina, anders via de tekst (trigram)."""
    if store_id and ad.landing_url and "/products/" in ad.landing_url:
        handle = urlsplit(ad.landing_url).path.split("/products/", 1)[1].strip("/").split("/")[0]
        cur.execute(
            """SELECT m.cluster_id FROM products p JOIN cluster_members m ON m.product_id = p.id
               WHERE p.store_id = %s AND p.handle = %s LIMIT 1""",
            (store_id, handle),
        )
        row = cur.fetchone()
        if row:
            return int(row["cluster_id"]), "landing_page"
    for text in (ad.headline, (ad.body or "").split("\n")[-1]):
        normalized = normalize_title(text or "")
        if len(normalized) < 4:
            continue
        cur.execute(MATCH_SQL, {"t": normalized})
        row = cur.fetchone()
        if row and float(row["score"]) >= TEXT_MATCH_THRESHOLD:
            return int(row["id"]), "text"
    return None


def ingest_ads(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    records: list[AdRecord],
    *,
    connector_id: str,
    now: datetime,
    today: date,
) -> IngestOutcome:
    out = IngestOutcome(ads=len(records))
    if not records:
        return out
    by_adv: dict[str, list[AdRecord]] = defaultdict(list)
    for r in records:
        by_adv[r.advertiser_external_id].append(r)
    snapshots: list[list[Any]] = []
    events: list[list[Any]] = []
    domain_cache: dict[str, int | None] = {}
    touched_clusters: set[int] = set()

    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        for adv_ext, ads in by_adv.items():
            platform = ads[0].platform
            cur.execute(
                """INSERT INTO advertisers (platform, external_id, name, first_seen, last_crawled)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (platform, external_id) DO UPDATE SET name = EXCLUDED.name, last_crawled = EXCLUDED.last_crawled
                   RETURNING id, store_id, (xmax = 0) AS inserted""",
                (platform, adv_ext, ads[0].advertiser_name, now, now),
            )
            adv = cur.fetchone()
            assert adv is not None
            adv_id = int(adv["id"])
            if adv["inserted"]:
                events.append(
                    [
                        "advertiser_new",
                        "advertiser",
                        adv_id,
                        now,
                        json.dumps({"name": ads[0].advertiser_name, "platform": platform}),
                    ]
                )

            cur.execute(
                "SELECT external_id, id, is_active, content_hash, creative_hash FROM ads WHERE platform = %s AND external_id = ANY(%s)",
                (platform, [a.external_id for a in ads]),
            )
            existing = {r["external_id"]: r for r in cur.fetchall()}
            cur.execute(
                "SELECT creative_hash, count(*) FILTER (WHERE is_active) AS n FROM ads WHERE advertiser_id = %s GROUP BY 1",
                (adv_id,),
            )
            groups_before = {r["creative_hash"]: int(r["n"]) for r in cur.fetchall()}

            # landingsdomein → winkel (meerderheid bepaalt de winkel van de adverteerder)
            store_votes: Counter[int] = Counter()
            unknown_domains: set[str] = set()
            for ad in ads:
                sid = _store_for_domain(cur, ad.landing_domain, domain_cache)
                if sid:
                    store_votes[sid] += 1
                elif ad.landing_domain:
                    unknown_domains.add(ad.landing_domain)
            store_id = adv["store_id"] or (store_votes.most_common(1)[0][0] if store_votes else None)
            if not store_id and not any(a.landing_domain for a in ads):
                # TikTok/Google geven geen landingspagina: koppel op bedrijfsnaam ≈ winkelnaam (streng)
                cur.execute(
                    """SELECT id, similarity(name, %(n)s) AS s FROM stores WHERE name %% %(n)s
                       ORDER BY s DESC LIMIT 1""",
                    {"n": ads[0].advertiser_name},
                )
                match = cur.fetchone()
                if match and float(match["s"]) >= NAME_MATCH_THRESHOLD:
                    store_id = int(match["id"])
            if store_id and not adv["store_id"]:
                cur.execute("UPDATE advertisers SET store_id = %s WHERE id = %s", (store_id, adv_id))
                out.linked_stores += 1
            if unknown_domains:
                cur.execute(
                    """INSERT INTO store_candidates (domain, source, discovered_at)
                       SELECT d, 'ads_landing', %s FROM unnest(%s::text[]) d
                       WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.domain = d) ON CONFLICT DO NOTHING""",
                    (now, sorted(unknown_domains)),
                )
                out.new_candidates += cur.rowcount

            for ad in ads:
                prev = existing.get(ad.external_id)
                cur.execute(
                    """INSERT INTO ads (platform, external_id, advertiser_id, format, body, headline, cta, landing_url,
                         countries, languages, start_date, end_date, is_active, source_connector, snapshot_url,
                         link_caption, link_description, publisher_platforms, creative_hash, eu_reach, impressions_low,
                         impressions_high, target_ages, target_gender, landing_domain, content_hash, first_seen, last_seen,
                         media, thumbnail_url, media_urls)
                       VALUES (%(platform)s, %(ext)s, %(adv)s, %(format)s, %(body)s, %(headline)s, %(cta)s, %(landing)s,
                         %(countries)s, %(languages)s, %(start)s, %(end)s, %(active)s, %(connector)s, %(snapshot)s,
                         %(caption)s, %(desc)s, %(platforms)s, %(creative)s, %(reach)s, %(imp_lo)s, %(imp_hi)s,
                         %(ages)s, %(gender)s, %(domain)s, %(hash)s, %(now)s, %(now)s, %(media)s, %(thumb)s, %(media_urls)s)
                       ON CONFLICT (platform, external_id) DO UPDATE SET
                         advertiser_id = EXCLUDED.advertiser_id, body = EXCLUDED.body, headline = EXCLUDED.headline,
                         countries = EXCLUDED.countries, languages = EXCLUDED.languages, end_date = EXCLUDED.end_date,
                         is_active = EXCLUDED.is_active, snapshot_url = EXCLUDED.snapshot_url,
                         link_caption = EXCLUDED.link_caption, publisher_platforms = EXCLUDED.publisher_platforms,
                         creative_hash = EXCLUDED.creative_hash, eu_reach = EXCLUDED.eu_reach,
                         impressions_low = EXCLUDED.impressions_low, impressions_high = EXCLUDED.impressions_high,
                         landing_domain = EXCLUDED.landing_domain, content_hash = EXCLUDED.content_hash,
                         last_seen = EXCLUDED.last_seen,
                         format = COALESCE(EXCLUDED.format, ads.format), cta = COALESCE(EXCLUDED.cta, ads.cta),
                         landing_url = COALESCE(EXCLUDED.landing_url, ads.landing_url),
                         media = CASE WHEN jsonb_array_length(EXCLUDED.media) > 0 THEN EXCLUDED.media ELSE ads.media END,
                         thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, ads.thumbnail_url),
                         media_urls = CASE WHEN cardinality(EXCLUDED.media_urls) > 0 THEN EXCLUDED.media_urls ELSE ads.media_urls END
                       RETURNING id""",
                    {
                        "platform": ad.platform,
                        "ext": ad.external_id,
                        "adv": adv_id,
                        "format": ad.format,
                        "body": ad.body,
                        "headline": ad.headline,
                        "cta": ad.cta,
                        "landing": ad.landing_url,
                        "countries": ad.countries,
                        "languages": ad.languages,
                        "start": ad.start_date,
                        "end": ad.end_date,
                        "active": ad.is_active,
                        "connector": connector_id,
                        "snapshot": ad.snapshot_url,
                        "caption": ad.link_caption,
                        "desc": ad.link_description,
                        "platforms": ad.publisher_platforms,
                        "creative": ad.creative_hash,
                        "reach": ad.eu_reach,
                        "imp_lo": ad.impressions_low,
                        "imp_hi": ad.impressions_high,
                        "ages": ad.target_ages,
                        "gender": ad.target_gender,
                        "domain": ad.landing_domain,
                        "hash": ad.content_hash,
                        "now": now,
                        "media": Jsonb([m.model_dump() for m in ad.media]),
                        "thumb": next((m.poster or m.url for m in ad.media), None),
                        "media_urls": [m.url for m in ad.media],
                    },
                )
                row = cur.fetchone()
                assert row is not None
                ad_id = int(row["id"])
                payload = {
                    "ad_id": ad_id,
                    "title": ad.headline or (ad.body or "")[:80],
                    "advertiser": ad.advertiser_name,
                    "platform": ad.platform,
                    "image": next((m.poster or m.url for m in ad.media), None),
                }
                if prev is None:
                    out.events["ad_started" if ad.is_active else "ad_seen_inactive"] += 1
                    out.new_ad_ids.append(ad_id)
                    if ad.is_active:
                        events.append(["ad_started", "advertiser", adv_id, now, json.dumps(payload)])
                        if store_id:
                            events.append(["ad_started", "store", store_id, now, json.dumps(payload)])
                elif prev["is_active"] and not ad.is_active:
                    out.events["ad_stopped"] += 1
                    events.append(["ad_stopped", "advertiser", adv_id, now, json.dumps(payload)])
                    if store_id:
                        events.append(["ad_stopped", "store", store_id, now, json.dumps(payload)])
                if prev is None or prev["content_hash"] != ad.content_hash:
                    snapshots.append(
                        [ad_id, now, int(ad.is_active), 1, None, None, None, ad.eu_reach or ad.impressions_high]
                    )

                # Koppelen alleen bij nieuwe ads: tekst en landingspagina van een ad veranderen niet
                linked = _cluster_for_ad(cur, ad, store_id) if prev is None else None
                if linked:
                    cluster_id, method = linked
                    cur.execute(
                        """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence, first_seen, last_seen)
                           VALUES ('ad', %s, 'product_cluster', %s, 'promotes', %s, %s, %s, %s)
                           ON CONFLICT (from_type, from_id, to_type, to_id, link_type) DO UPDATE SET last_seen = EXCLUDED.last_seen""",
                        (
                            ad_id,
                            cluster_id,
                            0.95 if method == "landing_page" else 0.7,
                            Jsonb({"method": method}),
                            now,
                            now,
                        ),
                    )
                    touched_clusters.add(cluster_id)
                    out.linked_products += 1

            # Varianten: actieve ads met dezelfde creative; 'scaling' als een groep ≥ 2 varianten groeit
            cur.execute(
                """WITH g AS (SELECT creative_hash, count(*) FILTER (WHERE is_active) AS n FROM ads WHERE advertiser_id = %s GROUP BY 1)
                   UPDATE ads a SET variants_count = GREATEST(1, g.n) FROM g
                   WHERE a.advertiser_id = %s AND a.creative_hash = g.creative_hash
                   RETURNING a.creative_hash, a.variants_count""",
                (adv_id, adv_id),
            )
            groups_after = {r["creative_hash"]: int(r["variants_count"]) for r in cur.fetchall()}
            for h, n in groups_after.items():
                if n - groups_before.get(h, 0) >= 2 and groups_before.get(h, 0) > 0:
                    out.events["ad_scaling"] += 1
                    events.append(
                        ["ad_scaling", "advertiser", adv_id, now, json.dumps({"creative_hash": h, "variants": n})]
                    )

            # Schattingen (varianten bekend) + adverteerder-aggregaten
            for ad in ads:
                prev = existing.get(ad.external_id)
                variants = groups_after.get(ad.creative_hash, 1)
                if (
                    prev is not None
                    and prev["content_hash"] == ad.content_hash
                    and groups_before.get(ad.creative_hash) == variants
                ):
                    continue  # niets veranderd dat de schatting raakt
                reach = estimate_reach(ad, variants, today)
                cur.execute(
                    "UPDATE ads SET est_reach = %s, est_spend = %s WHERE platform = %s AND external_id = %s",
                    (
                        Jsonb(reach) if reach else None,
                        Jsonb(estimate_spend(reach, ad.countries)) if reach else None,
                        ad.platform,
                        ad.external_id,
                    ),
                )
            cur.execute(
                """UPDATE advertisers SET
                     active_ads = (SELECT count(*) FROM ads WHERE advertiser_id = %(id)s AND is_active),
                     total_ads = (SELECT count(*) FROM ads WHERE advertiser_id = %(id)s),
                     eu_reach_total = (SELECT coalesce(sum(eu_reach), 0) FROM ads WHERE advertiser_id = %(id)s),
                     first_ad_at = (SELECT min(start_date) FROM ads WHERE advertiser_id = %(id)s),
                     new_ads_7d = (SELECT count(*) FROM ads WHERE advertiser_id = %(id)s AND first_seen > %(since)s)
                   WHERE id = %(id)s""",
                {"id": adv_id, "since": now - timedelta(days=7)},
            )
            if store_id:
                # Gecrawlde winkels: live ads = onze eigen telling (geseede winkels houden hun gemodelleerde reeks)
                cur.execute(
                    """UPDATE stores SET live_ads = (SELECT count(*) FROM ads a JOIN advertisers v ON v.id = a.advertiser_id
                                                     WHERE v.store_id = %(s)s AND a.is_active)
                       WHERE id = %(s)s AND data_source = 'crawl'""",
                    {"s": store_id},
                )

        for cluster_id in sorted(touched_clusters):  # vaste volgorde: geen deadlocks bij parallelle runs
            cur.execute(
                """UPDATE product_clusters SET ad_count = (SELECT count(*) FROM entity_links l JOIN ads a ON a.id = l.from_id
                     WHERE l.from_type = 'ad' AND l.to_type = 'product_cluster' AND l.to_id = %s) WHERE id = %s""",
                (cluster_id, cluster_id),
            )

    if snapshots:
        ch.insert(
            "ad_snapshots",
            snapshots,
            column_names=[
                "ad_id",
                "captured_at",
                "is_active",
                "variants_count",
                "likes",
                "comments",
                "shares",
                "views",
            ],
        )
    if events:
        ch.insert(
            "change_events", events, column_names=["event_type", "entity_type", "entity_id", "occurred_at", "payload"]
        )
    return out


_HANDLE = re.compile(r"/products/([\w-]+)")


def relink_by_landing_page(conn: psycopg.Connection[Any], ad_ids: list[int], now: datetime) -> int:
    """Meta geeft de landingspagina pas via de snapshot: waar die naar een bekend product wijst, is dat sterker
    bewijs dan de tekstmatch van de eerste ingest. Werkt de koppeling (en het bewijs) dan bij."""
    if not ad_ids:
        return 0
    upgraded = 0
    clusters: set[int] = set()
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT a.id, a.landing_url, v.store_id FROM ads a JOIN advertisers v ON v.id = a.advertiser_id
               WHERE a.id = ANY(%s) AND a.landing_url LIKE '%%/products/%%' AND v.store_id IS NOT NULL""",
            (ad_ids,),
        )
        for row in cur.fetchall():
            handle = urlsplit(row["landing_url"]).path.split("/products/", 1)[1].strip("/").split("/")[0]
            cur.execute(
                """SELECT m.cluster_id FROM products p JOIN cluster_members m ON m.product_id = p.id
                   WHERE p.store_id = %s AND p.handle = %s LIMIT 1""",
                (row["store_id"], handle),
            )
            match = cur.fetchone()
            if not match:
                continue
            # tekstmatch naar een ander cluster vervalt; de landingspagina is leidend
            cur.execute(
                """DELETE FROM entity_links WHERE from_type = 'ad' AND from_id = %s AND to_type = 'product_cluster'
                   AND to_id <> %s AND evidence->>'method' = 'text' RETURNING to_id""",
                (row["id"], match["cluster_id"]),
            )
            clusters |= {int(r["to_id"]) for r in cur.fetchall()} | {int(match["cluster_id"])}
            cur.execute(
                """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence, first_seen, last_seen)
                   VALUES ('ad', %s, 'product_cluster', %s, 'promotes', 0.95, %s, %s, %s)
                   ON CONFLICT (from_type, from_id, to_type, to_id, link_type)
                   DO UPDATE SET confidence = 0.95, evidence = EXCLUDED.evidence, last_seen = EXCLUDED.last_seen""",
                (row["id"], match["cluster_id"], Jsonb({"method": "landing_page"}), now, now),
            )
            upgraded += 1
        for cluster_id in sorted(clusters):
            cur.execute(
                """UPDATE product_clusters SET ad_count = (SELECT count(*) FROM entity_links
                     WHERE from_type = 'ad' AND to_type = 'product_cluster' AND to_id = %s) WHERE id = %s""",
                (cluster_id, cluster_id),
            )
    return upgraded
