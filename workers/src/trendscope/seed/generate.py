"""Deterministische demo-dataset: alle modules hebben samenhangende data zonder externe API's.

Gebruik: `uv run trendscope seed` (wist eerst de data-tabellen; gebruikers blijven behouden).
"""

from __future__ import annotations

import json
import math
import random
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote

import psycopg
from psycopg.types.json import Jsonb

from trendscope.connectors.base import load_manifests
from trendscope.core.clickhouse import get_client
from trendscope.core.settings import get_settings
from trendscope.scoring.engine import DEFAULT_WEIGHTS, EntityInput, Signal, score_population
from trendscope.seed import catalog as C

SEED = 42
SIGNAL_DAYS = 90
STORE_DAYS = 365
SCORE_HISTORY_DAYS = 45
TODAY = date.today()  # data is deterministisch, maar altijd relatief aan vandaag

ARCHETYPES = ["emerging", "rising", "rising", "peak", "saturated", "declining", "noise", "ads_only"]
STORE_ARCHETYPES = ["scaling", "scaling", "stable", "stable", "stable", "new", "declining", "ad_peak"]


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def media(kind: str, **params: Any) -> str:
    """URL naar de demo-media-route van de web-app (SVG's worden daar deterministisch gerenderd)."""
    qs = "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
    return f"/media/demo/{kind}.svg?{qs}"


def curve(arch: str, n: int, rng: random.Random) -> list[float]:
    """Vorm van een tijdreeks (≈0–1) per archetype, met realistische ruis."""
    out = []
    for i in range(n):
        x = i / (n - 1)
        if arch == "emerging":
            v = 0.08 + 0.92 * max(0.0, x - 0.8) ** 1.5 / 0.2**1.5
        elif arch in ("rising", "scaling"):
            v = 0.15 + 0.85 * x**1.4
        elif arch == "peak":
            v = 0.1 + 0.9 * min(1.0, (x / 0.78) ** 1.8)
        elif arch == "saturated":
            v = 0.85 + 0.05 * math.sin(i / 9)
        elif arch == "declining":
            v = 0.2 + 0.8 * (x / 0.55 if x < 0.55 else max(0.25, 1 - (x - 0.55) * 1.6))
        elif arch == "new":
            v = 0.0 if x < 0.7 else 0.1 + 0.9 * ((x - 0.7) / 0.3) ** 1.2
        elif arch == "ad_peak":
            v = 0.5 + 0.5 * math.exp(-(((x - 0.93) / 0.06) ** 2))
        else:  # noise / stable / ads_only (basis)
            v = 0.5
        weekly = 1 + 0.06 * math.sin(2 * math.pi * i / 7)
        out.append(max(0.0, v * weekly * rng.uniform(0.92, 1.08)))
    return out


@dataclass
class World:
    rng: random.Random
    niches: dict[str, int] = field(default_factory=dict)
    clusters: list[dict[str, Any]] = field(default_factory=list)
    stores: list[dict[str, Any]] = field(default_factory=list)


def weighted_country(rng: random.Random) -> str:
    return rng.choices([c for c, _ in C.COUNTRIES], weights=[w for _, w in C.COUNTRIES])[0]


def brand_name(rng: random.Random, used: set[str]) -> str:
    while True:
        name = rng.choice(C.NAME_HEADS) + rng.choice(C.NAME_TAILS)
        name = name[0].upper() + name[1:].lower()
        if name not in used:
            used.add(name)
            return name


def visitor_mix(rng: random.Random, home: str) -> list[dict[str, Any]]:
    others = [c for c, _ in C.COUNTRIES if c != home]
    rng.shuffle(others)
    shares = [rng.uniform(0.35, 0.7)]
    rest = 1 - shares[0]
    for _ in range(4):
        s = rest * rng.uniform(0.2, 0.5)
        shares.append(s)
        rest -= s
    mix = [{"country": home, "share": round(shares[0], 4)}]
    mix += [{"country": c, "share": round(s, 4)} for c, s in zip(others[:4], shares[1:], strict=True)]
    return mix


def traffic_sources(rng: random.Random) -> dict[str, float]:
    raw = {
        "direct": rng.uniform(25, 50),
        "organic_search": rng.uniform(10, 30),
        "paid_search": rng.uniform(4, 18),
        "social": rng.uniform(3, 20),
        "referral": rng.uniform(2, 8),
        "ads": rng.uniform(1, 12),
        "mail": rng.uniform(0.2, 3),
    }
    total = sum(raw.values())
    return {k: round(v / total * 100, 1) for k, v in raw.items()}


def run(reset: bool = True) -> dict[str, int]:
    settings = get_settings()
    rng = random.Random(SEED)
    world = World(rng)
    ch = get_client()
    now = datetime.combine(TODAY, datetime.min.time(), tzinfo=UTC)

    with psycopg.connect(settings.database_url, autocommit=False) as conn, conn.cursor() as cur:
        if reset:
            cur.execute(
                """TRUNCATE niches, stores, store_technologies, product_clusters, products, cluster_members,
                   suppliers, supplier_offers, advertisers, ads, creators, videos, keywords, entity_links,
                   scores, score_weights, connectors, crawl_targets, crawl_jobs, curated_lists, curated_list_items,
                   watchlists, alert_rules, alert_events RESTART IDENTITY CASCADE"""
            )
            for table in (
                "product_snapshots",
                "ad_snapshots",
                "creator_snapshots",
                "video_snapshots",
                "entity_signals_daily",
                "keyword_signals",
                "score_history",
                "change_events",
                "store_metrics_daily",
            ):
                ch.command(f"TRUNCATE TABLE IF EXISTS {table}")

        # ── Niches ────────────────────────────────────────────────
        for slug, nl, en, _emoji in C.NICHES:
            cur.execute("INSERT INTO niches (slug, name_nl, name_en) VALUES (%s,%s,%s) RETURNING id", (slug, nl, en))
            world.niches[slug] = _returned_id(cur)

        # ── Product clusters ─────────────────────────────────────
        for niche_slug, items in C.PRODUCTS.items():
            for title, emoji, price, cost, category in items:
                arch = rng.choice(ARCHETYPES)
                hue = rng.randint(0, 359)
                cur.execute(
                    """INSERT INTO product_clusters (canonical_title, slug, niche_id, category, keywords, image_url,
                         min_price, max_price, currency, first_seen, is_curated)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'EUR',%s,%s) RETURNING id""",
                    (
                        title,
                        slugify(title),
                        world.niches[niche_slug],
                        category,
                        [w.lower() for w in title.split()[:2]],
                        media("product", e=emoji, h=hue),
                        round(price * 0.85, 2),
                        round(price * 1.2, 2),
                        now - timedelta(days=rng.randint(20, 400)),
                        arch in ("emerging", "rising") and rng.random() < 0.4,
                    ),
                )
                world.clusters.append(
                    {
                        "id": _returned_id(cur),
                        "title": title,
                        "emoji": emoji,
                        "price": price,
                        "cost": cost,
                        "niche": niche_slug,
                        "arch": arch,
                        "hue": hue,
                        "stores": [],
                        "ads": 0,
                        "advertisers": set(),
                        "creators": 0,
                    }
                )

        clusters_by_niche: dict[str, list[dict[str, Any]]] = {}
        for c in world.clusters:
            clusters_by_niche.setdefault(c["niche"], []).append(c)

        # ── Stores ───────────────────────────────────────────────
        used_names: set[str] = set()
        store_metric_rows: list[list[Any]] = []
        for _ in range(180):
            name = brand_name(rng, used_names)
            country = weighted_country(rng)
            tld = (
                {
                    "NL": ".nl",
                    "DE": ".de",
                    "GB": ".co.uk",
                    "AU": ".com.au",
                    "BE": ".be",
                    "FR": ".fr",
                    "SE": ".se",
                    "IT": ".it",
                    "CA": ".ca",
                }.get(country, ".com")
                if rng.random() < 0.45
                else rng.choice([".com", ".com", ".co", ".shop", ".store"])
            )
            niche_slug = rng.choice(list(C.PRODUCTS))
            second_niche = rng.choice(list(C.PRODUCTS)) if rng.random() < 0.35 else None
            arch = rng.choice(STORE_ARCHETYPES)
            scale = min(6e6, math.exp(rng.gauss(11.6, 1.3)))  # mediane ~110k bezoeken/maand, lange staart
            launched = TODAY - timedelta(days=rng.randint(40 if arch == "new" else 120, 2400))
            if arch == "new":
                launched = TODAY - timedelta(days=rng.randint(30, 100))
            color = f"hsl({rng.randint(0, 359)} {rng.randint(45, 75)}% {rng.randint(30, 45)}%)"
            visits_curve = curve(arch, STORE_DAYS, rng)
            alive_from = max(0, STORE_DAYS - (TODAY - launched).days)
            daily_visits = [0.0 if i < alive_from else scale / 30 * v * 2 for i, v in enumerate(visits_curve)]
            monthly = sum(daily_visits[-30:])
            prev_month = sum(daily_visits[-60:-30])
            live_curve = curve("ad_peak" if arch == "ad_peak" else arch, STORE_DAYS, rng)
            ad_scale = max(3.0, scale**0.62 / 4 * rng.uniform(0.4, 1.6))
            live_ads_series = [0 if i < alive_from else round(ad_scale * v * 2) for i, v in enumerate(live_curve)]
            followers = {
                "instagram": int(scale * rng.uniform(0.05, 0.6)),
                "facebook": int(scale * rng.uniform(0.02, 0.3)),
                "tiktok": int(scale * rng.uniform(0.0, 0.8)),
                "pinterest": int(scale * rng.uniform(0.0, 0.05)),
            }
            store = {
                "name": name,
                "domain": f"{name.lower()}{tld}",
                "country": country,
                "niche": niche_slug,
                "niches": [niche_slug] + ([second_niche] if second_niche and second_niche != niche_slug else []),
                "arch": arch,
                "monthly": int(monthly),
                "color": color,
                "live_ads": live_ads_series[-1],
                "age_days": (TODAY - launched).days,
            }
            cur.execute(
                """INSERT INTO stores (domain, platform, name, description, country, currency, languages, theme, niche_id,
                     social, launched_at, first_seen, last_crawled, monthly_visits, visits_growth, live_ads,
                     ads_growth_30d, ads_launched_total, visitor_countries, traffic_sources, social_followers,
                     trustpilot, screenshot_url, brand_color, est_revenue, est_traffic)
                   VALUES (%s,'shopify',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   RETURNING id""",
                (
                    store["domain"],
                    name,
                    f"{name} — {dict((n[0], n[2]) for n in C.NICHES)[niche_slug]}",
                    country,
                    C.CURRENCY[country],
                    [C.LANGUAGE[country]],
                    rng.choice(C.THEMES),
                    world.niches[niche_slug],
                    Jsonb({k: f"{name.lower()}" for k in followers if followers[k] > 500}),
                    launched,
                    now - timedelta(days=min(400, (TODAY - launched).days)),
                    now - timedelta(hours=rng.randint(1, 30)),
                    int(monthly),
                    round((monthly / prev_month - 1) * 100, 1) if prev_month > monthly * 0.05 else None,
                    live_ads_series[-1],
                    round(((live_ads_series[-1] + 3) / (live_ads_series[-31] + 3) - 1) * 100, 1)
                    if live_ads_series[-31] > 0
                    else None,
                    int(
                        sum(max(0, b - a) for a, b in zip(live_ads_series, live_ads_series[1:], strict=False)) * 1.8
                        + live_ads_series[-1]
                    ),
                    Jsonb(visitor_mix(rng, country)),
                    Jsonb(traffic_sources(rng)),
                    Jsonb(followers),
                    Jsonb({"score": round(rng.uniform(3.4, 4.9), 1), "reviews": int(scale**0.5 * rng.uniform(0.5, 4))}),
                    media("store", n=name, c=color, e=clusters_by_niche[niche_slug][0]["emoji"]),
                    color,
                    Jsonb(
                        _estimate(
                            monthly * rng.uniform(0.012, 0.03) * rng.uniform(35, 70),
                            "EUR",
                            "visits × conversie (1,2–3%) × gem. orderwaarde",
                        )
                    ),
                    Jsonb(_estimate(monthly, None, "panel + clickstream-model (demo)")),
                ),
            )
            store["id"] = _returned_id(cur)
            world.stores.append(store)

            for i in range(0, STORE_DAYS):
                d = TODAY - timedelta(days=STORE_DAYS - 1 - i)
                store_metric_rows.append([store["id"], "visits", d, round(daily_visits[i])])
                store_metric_rows.append([store["id"], "live_ads", d, live_ads_series[i]])
                if i % 7 == 0:
                    alive = max(0, i - alive_from) / max(1, STORE_DAYS - alive_from)
                    for net, f in followers.items():
                        value = 0 if i < alive_from else round(f * (0.15 + 0.85 * alive**1.3))
                        store_metric_rows.append([store["id"], f"followers_{net}", d, value])

            # Technologieën
            techs = [("theme", "Shopify")]
            techs += [("pixel", p) for p in rng.sample(C.TECH["pixel"], rng.randint(2, 7))]
            techs += [("app", a) for a in rng.sample(C.TECH["app"], rng.randint(3, 9))]
            techs += [("payment", p) for p in rng.sample(C.TECH["payment"], rng.randint(2, 4))]
            for t_type, t_name in techs:
                kind = t_type
                if t_name in ("Klaviyo", "Postscript"):
                    kind = "email"
                elif t_name in ("Judge.me", "Loox", "Okendo", "Yotpo"):
                    kind = "reviews"
                cur.execute(
                    "INSERT INTO store_technologies (store_id, type, name, detected_at) VALUES (%s,%s,%s,%s) "
                    "ON CONFLICT DO NOTHING",
                    (store["id"], kind, t_name, now - timedelta(days=rng.randint(1, 300))),
                )

        ch.insert("store_metrics_daily", store_metric_rows, column_names=["store_id", "metric", "date", "value"])

        # ── Producten per winkel ─────────────────────────────────
        product_count = 0
        snapshot_rows: list[list[Any]] = []
        for store in world.stores:
            pool = [c for n in store["niches"] for c in clusters_by_niche[n]]
            n_products = rng.randint(4, min(30, len(pool) * 3))
            chosen = [rng.choice(pool) for _ in range(n_products)]
            seen: set[int] = set()
            rank = 1
            for idx, cl in enumerate(chosen):
                variant = "" if cl["id"] not in seen else f" — {rng.choice(['Bundle', '2-Pack', 'Pro', 'Mini', 'XL'])}"
                seen.add(cl["id"])
                price = round(cl["price"] * rng.uniform(0.8, 1.25), 2) - 0.05
                title = f"{cl['title']}{variant}"
                cur.execute(
                    """INSERT INTO products (source, store_id, external_id, url, title, vendor, category, tags, images,
                         price, currency, first_seen, last_seen, best_seller_rank, content_hash)
                       VALUES ('shopify',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (
                        store["id"],
                        str(7_800_000_000_000 + store["id"] * 1000 + idx),
                        f"https://{store['domain']}/products/{slugify(title)}",
                        title,
                        store["name"],
                        None,
                        [cl["niche"]],
                        [media("product", e=cl["emoji"], h=(cl["hue"] + idx * 7) % 360)],
                        price,
                        "EUR",
                        now - timedelta(days=rng.randint(1, max(2, min(200, store["age_days"])))),
                        now,
                        rank if idx < 10 else None,
                        f"seed-{store['id']}-{idx}",
                    ),
                )
                pid = _returned_id(cur)
                rank += 1
                product_count += 1
                cur.execute(
                    "INSERT INTO cluster_members (cluster_id, product_id, confidence, method) VALUES (%s,%s,%s,%s)",
                    (cl["id"], pid, round(rng.uniform(0.82, 0.99), 2), rng.choice(["title", "phash", "embedding"])),
                )
                if store["id"] not in cl["stores"]:
                    cl["stores"].append(store["id"])
                    cur.execute(
                        """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence)
                           VALUES ('store',%s,'product_cluster',%s,'sells',%s,%s) ON CONFLICT DO NOTHING""",
                        (store["id"], cl["id"], 0.95, Jsonb({"product_id": pid})),
                    )
                # Prijs-snapshots: alleen bij wijziging (zoals de echte pipeline)
                p = price
                for day in sorted(rng.sample(range(SIGNAL_DAYS), rng.randint(1, 4))):
                    snapshot_rows.append(
                        [
                            pid,
                            now - timedelta(days=SIGNAL_DAYS - day),
                            p,
                            round(p * 1.6, 2),
                            "EUR",
                            None,
                            rng.randint(0, 900),
                            round(rng.uniform(4.1, 4.9), 1),
                            None,
                            1,
                            1,
                        ]
                    )
                    p = round(p * rng.choice([0.9, 0.95, 1.05, 1.1]), 2)
        ch.insert(
            "product_snapshots",
            snapshot_rows,
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

        # ── Adverteerders & ads ──────────────────────────────────
        ad_count = 0
        for store in world.stores:
            pages = [store["name"]] + (
                [f"{store['name']} {rng.choice(['Official', 'Shop', 'EU', 'Beauty'])}"] if rng.random() < 0.4 else []
            )
            for pi, page in enumerate(pages):
                cur.execute(
                    "INSERT INTO advertisers (platform, external_id, name, store_id) VALUES ('meta',%s,%s,%s) RETURNING id",
                    (str(100_000_000_000 + store["id"] * 10 + pi), page, store["id"]),
                )
                adv_id = _returned_id(cur)
                for _ in range(rng.randint(3, 9)):
                    cl = rng.choice([c for c in world.clusters if store["id"] in c["stores"]] or world.clusters)
                    start = TODAY - timedelta(days=min(int(rng.triangular(1, 220, 12)), store["age_days"]))
                    active = rng.random() < 0.72
                    fmt = rng.choices(["video", "image", "carousel"], weights=[6, 3, 1])[0]
                    hook = rng.choice(C.HOOKS).format(p=cl["title"].split()[-1].lower())
                    reach = int(rng.lognormvariate(10, 1.3))
                    cur.execute(
                        """INSERT INTO ads (platform, external_id, advertiser_id, format, body, headline, cta, media_urls,
                             thumbnail_url, landing_url, countries, languages, start_date, end_date, is_active,
                             variants_count, est_spend, est_reach, first_seen, last_seen)
                           VALUES ('meta',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                        (
                            str(900_000_000_000 + ad_count),
                            adv_id,
                            fmt,
                            f"{hook}\n\n{cl['title']} — free shipping today only. ⭐⭐⭐⭐⭐ 4.8/5 from 2,000+ customers.",
                            cl["title"],
                            rng.choice(C.CTAS),
                            [media("ad", e=cl["emoji"], c=store["color"], t=hook, v=int(fmt == "video"))],
                            media("ad", e=cl["emoji"], c=store["color"], t=hook, v=int(fmt == "video")),
                            f"https://{store['domain']}/products/{slugify(cl['title'])}",
                            sorted({store["country"]} | set(rng.sample(["NL", "BE", "DE", "FR", "GB", "US"], 2)))[:4],
                            ["en"],
                            start,
                            None if active else start + timedelta(days=rng.randint(3, 60)),
                            active,
                            rng.choices([1, 2, 3, 5, 8, 14], weights=[10, 6, 4, 2, 1, 1])[0],
                            Jsonb(
                                _estimate(
                                    reach * rng.uniform(0.004, 0.012), "EUR", "EU-transparantiebereik × CPM-model"
                                )
                            ),
                            Jsonb(_estimate(reach, None, "Meta EU-transparantiedata (demo)")),
                            datetime.combine(start, datetime.min.time(), tzinfo=UTC),
                            now,
                        ),
                    )
                    ad_id = _returned_id(cur)
                    ad_count += 1
                    cl["ads"] += 1
                    cl["advertisers"].add(adv_id)
                    cur.execute(
                        """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence)
                           VALUES ('ad',%s,'product_cluster',%s,'promotes',%s,%s) ON CONFLICT DO NOTHING""",
                        (ad_id, cl["id"], round(rng.uniform(0.75, 0.98), 2), Jsonb({"via": "landing_url"})),
                    )

        # ── Creators & video's ───────────────────────────────────
        for handle in C.CREATOR_HANDLES:
            creator_followers = int(rng.lognormvariate(11.5, 1.2))
            niche = rng.choice(list(C.PRODUCTS))
            cur.execute(
                """INSERT INTO creators (platform, handle, display_name, avatar_url, followers, engagement_rate, niches, est_gmv)
                   VALUES ('tiktok',%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (
                    handle,
                    handle.replace(".", " ").title(),
                    media("avatar", n=handle, h=rng.randint(0, 359)),
                    creator_followers,
                    round(rng.uniform(0.02, 0.12), 3),
                    [niche],
                    Jsonb(
                        _estimate(creator_followers * rng.uniform(0.05, 0.6), "EUR", "views × CTR × conversie (demo)")
                    ),
                ),
            )
            creator_id = _returned_id(cur)
            for v in range(rng.randint(3, 8)):
                cl = rng.choice(clusters_by_niche[niche] + rng.sample(world.clusters, 2))
                views = int(creator_followers * rng.uniform(0.2, 6))
                cur.execute(
                    """INSERT INTO videos (platform, external_id, creator_id, url, caption, hashtags, thumbnail_url,
                         posted_at, views, likes) VALUES ('tiktok',%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (
                        f"73{creator_id:04d}{v:03d}",
                        creator_id,
                        None,
                        f"{rng.choice(C.HOOKS).format(p=cl['title'].split()[-1].lower())} {cl['emoji']}",
                        ["tiktokmademebuyit", slugify(cl["title"]).replace("-", ""), cl["niche"].replace("-", "")],
                        media("ad", e=cl["emoji"], c=f"hsl({cl['hue']} 60% 40%)", t=cl["title"], v=1),
                        now - timedelta(days=rng.randint(0, 60)),
                        views,
                        int(views * rng.uniform(0.03, 0.12)),
                    ),
                )
                video_id = _returned_id(cur)
                cl["creators"] += 1
                cur.execute(
                    """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence)
                       VALUES ('creator',%s,'product_cluster',%s,'promotes',0.9), ('video',%s,'product_cluster',%s,'promotes',0.9)
                       ON CONFLICT DO NOTHING""",
                    (creator_id, cl["id"], video_id, cl["id"]),
                )

        # ── Keywords, leveranciers ───────────────────────────────
        supplier_ids = []
        for i, (source, name, rating) in enumerate(C.SUPPLIERS):
            cur.execute(
                "INSERT INTO suppliers (source, external_id, name, rating) VALUES (%s,%s,%s,%s) RETURNING id",
                (source, f"sup-{i}", name, rating),
            )
            supplier_ids.append((_returned_id(cur), source))
        for cl in world.clusters:
            term = " ".join(cl["title"].lower().split()[-2:])
            cur.execute(
                "INSERT INTO keywords (term, language, niche_id) VALUES (%s,'en',%s) ON CONFLICT DO NOTHING RETURNING id",
                (term, world.niches[cl["niche"]]),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    "INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type) VALUES ('keyword',%s,'product_cluster',%s,'searched_as')",
                    (row[0], cl["id"]),
                )
            for sid, source in rng.sample(supplier_ids, 3):
                lo = rng.randint(5, 9) if source != "cj" else rng.randint(3, 6)
                cur.execute(
                    """INSERT INTO supplier_offers (supplier_id, cluster_id, url, price, shipping_cost, shipping_days, currency, orders)
                       VALUES (%s,%s,NULL,%s,%s,%s,'USD',%s)""",
                    (
                        sid,
                        cl["id"],
                        round(cl["cost"] * rng.uniform(0.85, 1.2), 2),
                        round(rng.uniform(0, 4.5), 2),
                        f"[{lo},{lo + rng.randint(3, 9)}]",
                        int(rng.lognormvariate(7, 1.4)),
                    ),
                )

        # ── Signalen + scores ────────────────────────────────────
        signal_rows: list[list[Any]] = []
        series_by_cluster: dict[int, dict[Signal, list[float]]] = {}
        for cl in world.clusters:
            base = curve(cl["arch"] if cl["arch"] != "ads_only" else "noise", SIGNAL_DAYS, rng)
            flat = curve("noise", SIGNAL_DAYS, rng)
            ads_curve = curve("emerging" if cl["arch"] == "ads_only" else cl["arch"], SIGNAL_DAYS, rng)
            supply = max(1, len(cl["stores"]))
            sig_series: dict[Signal, list[float]] = {
                Signal.store: [
                    round(supply * (0.3 + 0.7 * v))
                    for v in curve(cl["arch"] if cl["arch"] != "ads_only" else "noise", SIGNAL_DAYS, rng)
                ],
                Signal.ads: [round(max(1, cl["ads"]) * 3 * v) for v in ads_curve],
                Signal.social: [round(40_000 * v * rng.uniform(0.5, 2)) for v in base],
                Signal.search: [round(100 * v, 1) for v in (base if rng.random() < 0.85 else flat)],
                Signal.marketplace: [round(300 * v) for v in (base if rng.random() < 0.7 else flat)],
            }
            if rng.random() < 0.6:
                sig_series[Signal.tiktokshop] = [round(120 * v) for v in base]
            if rng.random() < 0.5:
                sig_series[Signal.reddit] = [round(12 * v) for v in (base if rng.random() < 0.6 else flat)]
            series_by_cluster[cl["id"]] = sig_series
            for sig, values in sig_series.items():
                for i, value in enumerate(values):
                    signal_rows.append(
                        [
                            "product_cluster",
                            cl["id"],
                            sig.value,
                            TODAY - timedelta(days=SIGNAL_DAYS - 1 - i),
                            float(value),
                        ]
                    )
        ch.insert(
            "entity_signals_daily", signal_rows, column_names=["entity_type", "entity_id", "source", "date", "value"]
        )

        cur.execute(
            "INSERT INTO score_weights (version, weights, params, is_active, note) VALUES (1,%s,'{}',true,'Startgewichten')",
            (Jsonb(DEFAULT_WEIGHTS),),
        )
        history_rows: list[list[Any]] = []
        latest = []
        for back in range(SCORE_HISTORY_DAYS - 1, -1, -1):
            score_day = TODAY - timedelta(days=back)
            inputs = [
                EntityInput(
                    entity_id=cl["id"],
                    series={sig: v[: SIGNAL_DAYS - back] for sig, v in series_by_cluster[cl["id"]].items()},
                    store_count=len(cl["stores"]),
                    advertiser_count=len(cl["advertisers"]),
                    margin=round((cl["price"] - cl["cost"] * 0.92 - 4.5) / cl["price"], 3),
                    category=cl["niche"],
                )
                for cl in world.clusters
            ]
            results = score_population(inputs)
            for r in results:
                history_rows.append(
                    [
                        "product_cluster",
                        r.entity_id,
                        score_day,
                        r.growth_velocity,
                        r.validation,
                        r.saturation,
                        r.opportunity,
                        r.phase,
                        1,
                    ]
                )
            latest = results
        ch.insert(
            "score_history",
            history_rows,
            column_names=[
                "entity_type",
                "entity_id",
                "date",
                "growth_velocity",
                "validation",
                "saturation",
                "opportunity",
                "phase",
                "weights_version",
            ],
        )
        for r in latest:
            cur.execute(
                """INSERT INTO scores (entity_type, entity_id, date, growth_velocity, validation, saturation, opportunity,
                     phase, breakdown, weights_version) VALUES ('product_cluster',%s,%s,%s,%s,%s,%s,%s,%s,1)""",
                (
                    r.entity_id,
                    TODAY,
                    r.growth_velocity,
                    r.validation,
                    r.saturation,
                    r.opportunity,
                    r.phase,
                    Jsonb(r.breakdown),
                ),
            )
        for cl in world.clusters:
            cur.execute(
                "UPDATE product_clusters SET store_count=%s, ad_count=%s, creator_count=%s WHERE id=%s",
                (len(cl["stores"]), cl["ads"], cl["creators"], cl["id"]),
            )
        cur.execute("UPDATE stores s SET product_count = (SELECT count(*) FROM products p WHERE p.store_id = s.id)")

        # ── Connectors ───────────────────────────────────────────
        manifests = load_manifests()
        planned = [
            ("meta_ad_library", "Meta Ad Library API", "official_api", 24),
            ("tiktok_commercial_content", "TikTok Commercial Content Library", "official_api", 24),
            ("google_trends", "Google Trends API (alpha)", "official_api", 24),
            ("reddit", "Reddit API", "official_api", 12),
            ("aliexpress_affiliate", "AliExpress Affiliate API", "official_api", 24),
            ("ct_logs", "Certificate Transparency-logs", "scrape_public", 6),
        ]
        for m in manifests.values():
            cur.execute(
                """INSERT INTO connectors (id, display_name, kind, enabled, legal_review, freshness_sla_hours, last_success_at)
                   VALUES (%s,%s,%s,true,%s,%s,%s)""",
                (
                    m.id,
                    m.display_name,
                    m.kind.value,
                    m.legal_review.value,
                    m.freshness_sla_hours,
                    now - timedelta(hours=3),
                ),
            )
        for cid, name, kind, sla in planned:
            cur.execute(
                "INSERT INTO connectors (id, display_name, kind, enabled, legal_review, freshness_sla_hours) VALUES (%s,%s,%s,false,'pending',%s)",
                (cid, name, kind, sla),
            )

        # ── Gecureerde lijsten (opgeslagen weergaven) ────────────
        lists: list[tuple[str, str, str, str, str, Callable[[dict[str, Any]], bool]]] = [
            (
                "weekly-gems",
                "store",
                "Weekly Gems",
                "Weekly Gems",
                "gem",
                lambda s: s["arch"] in ("new", "scaling") and s["monthly"] < 400_000,
            ),
            ("top-scaling", "store", "Top Scaling", "Top Scaling", "trending-up", lambda s: s["arch"] == "scaling"),
            (
                "market-leaders",
                "store",
                "Marktleiders & DTC",
                "Market Leaders & DTC",
                "crown",
                lambda s: s["monthly"] > 900_000,
            ),
            ("ad-peak", "store", "Advertentiepiek", "Shops' Ad Peak", "flame", lambda s: s["arch"] == "ad_peak"),
            (
                "traffic-peak",
                "store",
                "Trafficpiek",
                "Shops' Traffic Peak",
                "rocket",
                lambda s: s["arch"] in ("scaling", "new"),
            ),
        ]
        for pos, (slug, etype, nl, en, icon, pred) in enumerate(lists):
            cur.execute(
                "INSERT INTO curated_lists (slug, entity_type, name_nl, name_en, icon, position) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (slug, etype, nl, en, icon, pos),
            )
            list_id = _returned_id(cur)
            for i, st in enumerate([x for x in world.stores if pred(x)]):
                cur.execute(
                    "INSERT INTO curated_list_items (list_id, entity_id, position) VALUES (%s,%s,%s)",
                    (list_id, st["id"], i),
                )

        conn.commit()

    return {
        "niches": len(world.niches),
        "clusters": len(world.clusters),
        "stores": len(world.stores),
        "products": product_count,
        "ads": ad_count,
        "store_metric_points": len(store_metric_rows),
        "signal_points": len(signal_rows),
        "score_history_points": len(history_rows),
    }


def _returned_id(cur: psycopg.Cursor[Any]) -> Any:
    row = cur.fetchone()
    assert row is not None, "INSERT ... RETURNING gaf geen rij terug"
    return row[0]


def _estimate(value: float, currency: str | None, method: str) -> dict[str, Any]:
    """Schatting met bandbreedte en betrouwbaarheid; de UI toont dit altijd als schatting."""
    out: dict[str, Any] = {
        "value": round(value),
        "low": round(value * 0.65),
        "high": round(value * 1.45),
        "confidence": "medium" if value > 5000 else "low",
        "method": method,
    }
    if currency:
        out["currency"] = currency
    return out


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
