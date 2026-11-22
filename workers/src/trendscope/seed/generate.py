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

from trendscope.ads.estimates import estimate_reach, estimate_spend
from trendscope.ads.records import AdRecord
from trendscope.connectors.base import load_manifests
from trendscope.core.clickhouse import get_client
from trendscope.core.settings import get_settings
from trendscope.mockweb.baseline import StoreBaseline, write_baseline
from trendscope.mockweb.trend_world import core_term
from trendscope.scoring.engine import DEFAULT_WEIGHTS, EntityInput, Signal, score_population
from trendscope.seed import catalog as C

SEED = 42
SIGNAL_DAYS = 90
STORE_DAYS = 365
SCORE_HISTORY_DAYS = 45
# De seed beschrijft de wereld op 'day0'; `trendscope simulate` crawlt daarna dag voor dag tot vandaag.
SIMULATION_DAYS = 14
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
                   watchlists, alert_rules, alert_events, store_candidates, cluster_merges, reddit_mentions,
                   signal_scales, forecasts, backtests, tiktok_shops, livestreams, livestream_products, mailboxes,
                   email_subscriptions, emails, feature_flags RESTART IDENTITY CASCADE"""
            )
            for table in (
                "product_snapshots",
                "ad_snapshots",
                "creator_snapshots",
                "video_snapshots",
                "entity_signals_daily",
                "keyword_signals",
                "keyword_signals_daily",
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
                        "category": category,
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
            store: dict[str, Any] = {
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
                "theme": rng.choice(C.THEMES),
                "currency": C.CURRENCY[country],
                "language": C.LANGUAGE[country],
                "social": {k: name.lower() for k in followers if followers[k] > 500},
                "techs": [],
                "baseline_products": [],
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
                    store["theme"],
                    world.niches[niche_slug],
                    Jsonb(store["social"]),
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
                store["techs"].append(t_name)
            for f_name in C.funnel_apps(store["domain"]):
                cur.execute(
                    "INSERT INTO store_technologies (store_id, type, name, detected_at) VALUES (%s,'app',%s,%s) ON CONFLICT DO NOTHING",
                    (store["id"], f_name, now - timedelta(days=1 + len(f_name) * 7 % 200)),
                )
                store["techs"].append(f_name)

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
                price = round(round(cl["price"] * rng.uniform(0.8, 1.25), 2) - 0.05, 2)
                title = f"{cl['title']}{variant}"
                handle = slugify(title)
                compare_at = round(price * rng.choice([1.4, 1.6, 2.0]), 2) if rng.random() < 0.6 else None
                sizes = rng.choice(
                    [["Default Title"], ["S", "M", "L"], ["1-Pack", "2-Pack"], ["Black", "White", "Sage"]]
                )
                variants = [
                    {
                        "id": f"{store['id']}{idx:03d}{vi:02d}",
                        "title": v,
                        "price": price,
                        "available": rng.random() > 0.08,
                    }
                    for vi, v in enumerate(sizes)
                ]
                # vóór day0 gepubliceerd, zodat de gesimuleerde crawls daarna kloppen
                published = now - timedelta(
                    days=rng.randint(SIMULATION_DAYS + 2, max(SIMULATION_DAYS + 3, min(200, store["age_days"])))
                )
                image = media("product", e=cl["emoji"], h=(cl["hue"] + idx * 7) % 360)
                external_id = str(7_800_000_000_000 + store["id"] * 1000 + idx)
                cur.execute(
                    """INSERT INTO products (source, store_id, external_id, url, title, vendor, category, tags, images,
                         price, currency, first_seen, last_seen, best_seller_rank, content_hash, handle, compare_at_price,
                         available, variants, published_at)
                       VALUES ('shopify',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (
                        store["id"],
                        external_id,
                        f"https://{store['domain']}/products/{handle}",
                        title,
                        store["name"],
                        cl["category"],
                        [cl["niche"]],
                        [image],
                        price,
                        "EUR",
                        published,
                        now,
                        rank if idx < 10 else None,
                        None,
                        handle,
                        compare_at,
                        any(v["available"] for v in variants),
                        Jsonb(variants),
                        published,
                    ),
                )
                store["baseline_products"].append(
                    {
                        "id": external_id,
                        "handle": handle,
                        "title": title,
                        "price": price,
                        "compare_at_price": compare_at,
                        "variants": variants,
                        "published_at": published.isoformat(),
                        "image": image,
                        "best_seller_rank": rank if idx < 10 else None,
                        "product_type": cl["category"],
                        "vendor": store["name"],
                        "tags": [cl["niche"]],
                    }
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

        # ── Adverteerders & ads (dag 0 van de Meta Ad Library op het nep-internet) ──
        ad_count = 0
        sim_start = TODAY - timedelta(days=SIMULATION_DAYS + 1)
        for store in world.stores:
            pages = [store["name"]] + (
                [f"{store['name']} {rng.choice(['Official', 'Shop', 'EU', 'Beauty'])}"] if rng.random() < 0.4 else []
            )
            store["pages"] = []
            for pi, page in enumerate(pages):
                page_id = str(100_000_000_000 + store["id"] * 10 + pi)
                cur.execute(
                    """INSERT INTO advertisers (platform, external_id, name, store_id, page_url, avatar_url, country)
                       VALUES ('meta',%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (
                        page_id,
                        page,
                        store["id"],
                        f"https://www.facebook.com/{page_id}",
                        media("avatar", n=page, h=rng.randint(0, 359)),
                        store["country"],
                    ),
                )
                adv_id = _returned_id(cur)
                page_ads: list[dict[str, Any]] = []
                for _ in range(rng.randint(3, 9)):
                    if page_ads and rng.random() < 0.3:
                        # variant: dezelfde creative, andere doelgroep/plaatsing
                        src = rng.choice(page_ads)
                        cl = next(c for c in world.clusters if c["id"] == src["cluster_id"])
                        hook, fmt, body, headline = src["hook"], src["format"], src["body"], src["headline"]
                    else:
                        cl = rng.choice([c for c in world.clusters if store["id"] in c["stores"]] or world.clusters)
                        hook = rng.choice(C.HOOKS).format(p=cl["title"].split()[-1].lower())
                        fmt = rng.choices(["video", "image", "carousel"], weights=[6, 3, 1])[0]
                        body = f"{hook}\n\n{cl['title']} — free shipping today only. ⭐⭐⭐⭐⭐ 4.8/5 from 2,000+ customers.{C.hashtags(cl['title'], store['id'])}"
                        headline = cl["title"]
                    start = sim_start - timedelta(
                        days=min(int(rng.triangular(1, 220, 12)), max(1, store["age_days"] - SIMULATION_DAYS - 1))
                    )
                    active = rng.random() < 0.72
                    end = (
                        None
                        if active
                        else min(sim_start - timedelta(days=1), start + timedelta(days=rng.randint(3, 60)))
                    )
                    eu = [c for c in ["NL", "BE", "DE", "FR", "ES", "IT", "AT", "SE"] if c != store["country"]]
                    countries = sorted(
                        ({store["country"]} if store["country"] in eu + ["NL"] else set())
                        | set(rng.sample(eu, rng.randint(1, 3)))
                    )
                    ext_id = str(900_000_000_000 + ad_count)
                    days = max(1, ((end or sim_start) - start).days)
                    ad_media = [
                        {
                            "type": "video" if fmt == "video" else "image",
                            "url": media("ad", e=cl["emoji"], c=store["color"], t=hook, v=int(fmt == "video")),
                            "poster": None,
                            "storage_key": None,
                        }
                    ]
                    record = AdRecord(
                        platform="meta",
                        external_id=ext_id,
                        advertiser_external_id=page_id,
                        advertiser_name=page,
                        format=fmt,
                        body=body,
                        headline=headline,
                        link_caption=store["domain"].upper(),
                        link_description="Free shipping · 30-day returns",
                        cta=rng.choice(C.CTAS),
                        landing_url=f"https://{store['domain']}/products/{slugify(cl['title'])}",
                        countries=countries,
                        languages=[store["language"]],
                        publisher_platforms=sorted(
                            rng.sample(["facebook", "instagram", "messenger", "audience_network"], rng.randint(1, 3))
                        ),
                        start_date=start,
                        end_date=end,
                        is_active=active,
                        snapshot_url=f"https://www.facebook.com/ads/archive/render_ad/?id={ext_id}",
                        eu_reach=int(rng.lognormvariate(7.5, 1.0) * days**0.8),
                        target_ages="18–65+",
                        target_gender="All",
                    )
                    reach = estimate_reach(record, 1, sim_start)
                    cur.execute(
                        """INSERT INTO ads (platform, external_id, advertiser_id, format, body, headline, cta, media_urls,
                             thumbnail_url, landing_url, countries, languages, start_date, end_date, is_active,
                             variants_count, est_spend, est_reach, first_seen, last_seen, source_connector, snapshot_url,
                             link_caption, link_description, publisher_platforms, creative_hash, eu_reach, media,
                             target_ages, target_gender, landing_domain, content_hash)
                           VALUES ('meta',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s,%s,%s,'meta_ad_library',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           RETURNING id""",
                        (
                            ext_id,
                            adv_id,
                            fmt,
                            body,
                            headline,
                            record.cta,
                            [ad_media[0]["url"]],
                            ad_media[0]["url"],
                            record.landing_url,
                            countries,
                            record.languages,
                            start,
                            end,
                            active,
                            Jsonb(estimate_spend(reach, countries)),
                            Jsonb(reach),
                            datetime.combine(start, datetime.min.time(), tzinfo=UTC),
                            now,
                            record.snapshot_url,
                            record.link_caption,
                            record.link_description,
                            record.publisher_platforms,
                            record.creative_hash,
                            record.eu_reach,
                            Jsonb(ad_media),
                            record.target_ages,
                            record.target_gender,
                            record.landing_domain,
                            record.content_hash,
                        ),
                    )
                    ad_id = _returned_id(cur)
                    ad_count += 1
                    cl["ads"] += 1
                    cl["advertisers"].add(adv_id)
                    cur.execute(
                        """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence)
                           VALUES ('ad',%s,'product_cluster',%s,'promotes',0.95,%s) ON CONFLICT DO NOTHING""",
                        (ad_id, cl["id"], Jsonb({"method": "landing_page"})),
                    )
                    page_ads.append(
                        record.model_dump(mode="json")
                        | {
                            "hook": hook,
                            "cluster_id": cl["id"],
                            "media": ad_media,
                            "emoji": cl["emoji"],
                            "color": store["color"],
                        }
                    )
                store["pages"].append({"page_id": page_id, "name": page, "ads": page_ads})
                cur.execute(
                    """WITH g AS (SELECT creative_hash, count(*) FILTER (WHERE is_active) n FROM ads WHERE advertiser_id = %(a)s GROUP BY 1)
                       UPDATE ads x SET variants_count = GREATEST(1, g.n) FROM g WHERE x.advertiser_id = %(a)s AND x.creative_hash = g.creative_hash""",
                    {"a": adv_id},
                )
                cur.execute(
                    """UPDATE advertisers SET active_ads = (SELECT count(*) FROM ads WHERE advertiser_id = %(a)s AND is_active),
                         total_ads = (SELECT count(*) FROM ads WHERE advertiser_id = %(a)s),
                         eu_reach_total = (SELECT coalesce(sum(eu_reach), 0) FROM ads WHERE advertiser_id = %(a)s),
                         first_ad_at = (SELECT min(start_date) FROM ads WHERE advertiser_id = %(a)s),
                         first_seen = (SELECT min(first_seen) FROM ads WHERE advertiser_id = %(a)s) WHERE id = %(a)s""",
                    {"a": adv_id},
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
            term = core_term(cl["title"])
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
        # Feature flags voor de functies uit fase 11 (beheer in /admin → Feature flags)
        for key, desc, rollout in (
            ("chrome_extension", "Chrome-extensie: winkel- en productanalyse op elke webshop", {"percent": 100}),
            (
                "push_to_store",
                "Product met één klik als concept naar je Shopify-winkel",
                {"percent": 100, "plans": ["pro", "business"]},
            ),
            ("public_api", "Publieke REST API v1 met API-sleutels", {"percent": 100, "plans": ["business"]}),
        ):
            cur.execute(
                """INSERT INTO feature_flags (key, description, enabled, rollout) VALUES (%s, %s, true, %s)
                   ON CONFLICT (key) DO NOTHING""",
                (key, desc, Jsonb(rollout)),
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
            ("google_trends", "Google Trends API (alpha)", "official_api", 24),
        ]
        for m in manifests.values():
            cur.execute(
                """INSERT INTO connectors (id, display_name, kind, enabled, legal_review, freshness_sla_hours, last_success_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    m.id,
                    m.display_name,
                    m.kind.value,
                    m.legal_review.value != "rejected",  # afgewezen bronnen staan uit
                    m.legal_review.value,
                    m.freshness_sla_hours,
                    None if m.legal_review.value == "rejected" else now - timedelta(hours=3),
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

        # ── Crawl-targets: elke winkel wordt door de scheduler opgepakt ──
        for store in world.stores:
            cur.execute(
                """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
                   VALUES ('shopify_storefront', %s, 'store', %s, %s, 86400, %s)""",
                (store["domain"], store["id"], 50, now + timedelta(minutes=rng.randint(0, 24 * 60))),
            )
            cur.execute(
                "UPDATE stores SET shopify_domain = %s WHERE id = %s",
                (f"{store['name'].lower()}.myshopify.com", store["id"]),
            )

        conn.commit()

    # Dag-0-staat van alle winkels: de basis van het nep-internet in mock-modus (zie trendscope.mockweb)
    write_baseline(
        [
            StoreBaseline(
                domain=st["domain"],
                name=st["name"],
                country=st["country"],
                currency=st["currency"],
                language=st["language"],
                theme=st["theme"],
                arch=st["arch"],
                color=st["color"],
                niches=st["niches"],
                technologies=st["techs"],
                pages=st["pages"],
                social=st["social"],
                products=st["baseline_products"],
            )
            for st in world.stores
        ],
        # simulate eindigt gisteren; een live crawl vandaag ziet dan nog één verse dag wijzigingen
        day0=TODAY - timedelta(days=SIMULATION_DAYS + 1),
        clusters=[
            {k: cl[k] for k in ("id", "title", "emoji", "price", "cost", "niche", "arch", "category", "hue")}
            for cl in world.clusters
        ],
    )

    seed_ad_targets(settings.database_url, now)
    seed_marketplace_targets(settings.database_url, now)
    seed_trend_targets(settings.database_url, now)
    seed_social_targets(settings.database_url, now)
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


def seed_ad_targets(database_url: str, now: datetime) -> None:
    """Crawl-targets voor ad-connectors: elke Meta-pagina volgen + zoektermen en TikTok/Google (demowereld)."""
    from trendscope.mockweb.ads_world import google_advertisers, reset_ads_caches, tiktok_advertisers
    from trendscope.mockweb.world import reset_caches

    reset_caches()
    reset_ads_caches()
    settings = get_settings()
    rng = random.Random(SEED + 3)
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
               SELECT 'meta_ad_library', 'page:' || external_id, 'advertiser', id, 40, 86400, %s FROM advertisers WHERE platform = 'meta'""",
            (now,),
        )
        for term in settings.ad_search_terms:
            cur.execute(
                "INSERT INTO crawl_targets (connector_id, target, priority, interval_secs, next_run_at) VALUES ('meta_ad_library', %s, 60, 86400, %s)",
                (f"q:{term}", now + timedelta(minutes=rng.randint(0, 600))),
            )
        for niche in C.PRODUCTS:
            cur.execute(
                "INSERT INTO crawl_targets (connector_id, target, priority, interval_secs, next_run_at) VALUES ('tiktok_commercial_content', %s, 60, 86400, %s)",
                (f"q:{niche}|NL", now),
            )
        # Google: adverteerders zoeken we live op naam in de dataset; in de demowereld zijn de IDs bekend
        for adv_id, store in google_advertisers().items():
            cur.execute(
                """INSERT INTO advertisers (platform, external_id, name, store_id, country)
                   SELECT 'google', %s, %s, s.id, s.country FROM stores s WHERE s.domain = %s
                   ON CONFLICT (platform, external_id) DO NOTHING RETURNING id""",
                (adv_id, store.name, store.domain),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
                       VALUES ('google_ads_transparency', %s, 'advertiser', %s, 50, 172800, %s)""",
                    (f"adv:{adv_id}", row[0], now),
                )
        _ = tiktok_advertisers  # TikTok-adverteerders ontdekken we via de zoektermen
        conn.commit()


def seed_marketplace_targets(database_url: str, now: datetime) -> None:
    """Embeddings voor de seed-producten + marktplaatszoektermen per productcluster en ontdekkingstermen."""
    from trendscope.clustering.engine import ensure_embeddings
    from trendscope.marketplaces.runner import MARKETPLACE_CONNECTORS
    from trendscope.mockweb.marketplace_world import MARKET_ONLY, _core, reset_marketplace_caches

    reset_marketplace_caches()
    with psycopg.connect(database_url) as conn:
        ensure_embeddings(conn, limit=100_000)
        with conn.cursor() as cur:
            # De seed heeft zijn producten al geclusterd; de clustering-job begint bij nieuwe producten
            cur.execute("UPDATE products SET clustered_at = %s", (now,))
            cur.execute("SELECT canonical_title FROM product_clusters ORDER BY id")
            terms = sorted({_core(t).lower() for (t,) in cur.fetchall()} | {t.lower() for t, *_ in MARKET_ONLY})
            for connector in sorted(MARKETPLACE_CONNECTORS):
                for term in terms:
                    cur.execute(
                        """INSERT INTO crawl_targets (connector_id, target, priority, interval_secs, next_run_at)
                           VALUES (%s, %s, 50, 86400, %s)""",
                        (connector, f"q:{term}", now),
                    )
        conn.commit()


def seed_trend_targets(database_url: str, now: datetime) -> None:
    """Onderwerpen zonder product als keyword, plus zoekinteresse- en Reddit-targets per keyword."""
    from trendscope.mockweb.trend_world import TOPICS, reset_trend_caches

    reset_trend_caches()
    settings = get_settings()
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        for term, niche, *_ in TOPICS:
            cur.execute(
                """INSERT INTO keywords (term, language, niche_id) SELECT %s, 'en', id FROM niches WHERE slug = %s
                   ON CONFLICT DO NOTHING""",
                (term, niche),
            )
        cur.execute("SELECT id FROM keywords WHERE kind = 'keyword' ORDER BY id")
        for (kid,) in cur.fetchall():
            for country in settings.trend_countries:
                cur.execute(
                    """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
                       VALUES ('dataforseo_trends', %s, 'keyword', %s, 50, 86400, %s)""",
                    (f"kw:{kid}|{country}", kid, now),
                )
            cur.execute(
                """INSERT INTO crawl_targets (connector_id, target, entity_type, entity_id, priority, interval_secs, next_run_at)
                   VALUES ('reddit', %s, 'keyword', %s, 50, 86400, %s)""",
                (f"kw:{kid}", kid, now),
            )
        conn.commit()


def seed_social_targets(database_url: str, now: datetime) -> None:
    """TikTok Shop-ontdekking per niche, bekende creators, YouTube-zoektermen en Instagram-profielen."""
    from trendscope.mockweb.tiktok_world import reset_tiktok_caches

    reset_tiktok_caches()
    settings = get_settings()
    rows: list[tuple[str, str]] = [("tiktok_shop_partner", f"cat:{n}|{settings.trend_country}") for n in C.PRODUCTS]
    rows += [("tiktok_shop_partner", f"creator:{h}") for h in C.CREATOR_HANDLES]
    rows += [("instagram_business", f"ig:{h}") for h in C.CREATOR_HANDLES[:10]]
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT term FROM keywords k WHERE kind = 'keyword' AND EXISTS (SELECT 1 FROM entity_links l WHERE l.from_type = 'keyword' AND l.from_id = k.id) ORDER BY id LIMIT 15"
        )
        rows += [("youtube_data", f"q:{t} review") for (t,) in cur.fetchall()]
        for connector, target in rows:
            cur.execute(
                "INSERT INTO crawl_targets (connector_id, target, priority, interval_secs, next_run_at) VALUES (%s, %s, 50, 86400, %s)",
                (connector, target, now),
            )
        conn.commit()


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
