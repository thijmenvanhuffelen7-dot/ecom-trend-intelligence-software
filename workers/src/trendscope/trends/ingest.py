"""Trend-targets uitvoeren en keyword-statistieken bijwerken.

Targets:
- dataforseo_trends  `kw:<keyword_id>|<land>`  → zoekinteresse (365 dagen, index 0–100) in keyword_signals_daily
- reddit             `kw:<keyword_id>`         → posts van de laatste week in reddit_mentions + dagtellingen
Hashtags leiden we af uit teksten die we al hebben (ad-teksten, later video-captions): geen extra bron nodig.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from trendscope.core.http import PoliteHttpClient
from trendscope.core.settings import Settings
from trendscope.pipeline.store_crawl import CrawlOutcome
from trendscope.trends import dataforseo, reddit
from trendscope.trends.forecast import forecast, keyword_trend, seasonality

TREND_CONNECTORS = {"dataforseo_trends", "reddit"}
HISTORY_DAYS = 730  # twee jaar: nodig om een seizoen van een trend te onderscheiden
HASHTAG = re.compile(r"#([a-z][a-z0-9_]{2,40})", re.I)
MIN_HASHTAG_USES = 3


def _cred(settings: Settings, value: str, name: str) -> str:
    if value:
        return value
    if settings.data_mode == "mock":
        return f"mock-{name.lower()}"
    raise RuntimeError(f"{name} ontbreekt")


def _parse_target(target: str) -> tuple[int, str]:
    body = target.removeprefix("kw:")
    kid, _, country = body.partition("|")
    return int(kid), country or "ALL"


def _insert_signals(ch: ClickHouse, rows: list[list[Any]]) -> None:
    if rows:
        ch.insert("keyword_signals_daily", rows, column_names=["keyword_id", "source", "country", "date", "value"])


def run_trends_target(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    settings: Settings,
    target: dict[str, Any],
    now: datetime,
) -> CrawlOutcome:
    kid, country = _parse_target(target["target"])
    row = conn.execute("SELECT term FROM keywords WHERE id = %s", (kid,)).fetchone()
    if row is None:
        return CrawlOutcome("succeeded", items=0, stats={"skipped": "keyword_removed"})
    term = str(row[0])
    today = now.date()
    if target["connector_id"] == "dataforseo_trends":
        points = dataforseo.explore(
            client,
            _cred(settings, settings.dataforseo_login, "DATAFORSEO_LOGIN"),
            _cred(settings, settings.dataforseo_password, "DATAFORSEO_PASSWORD"),
            term,
            country,
            today - timedelta(days=HISTORY_DAYS - 1),
            today,
        )
        _insert_signals(ch, [[kid, "search", country, d, float(v)] for d, v in points])
        if country == settings.trend_country:  # fase en forecast gelden voor de hoofdmarkt
            refresh_keyword(conn, ch, kid, now, country=settings.trend_country)
        return CrawlOutcome("succeeded", items=len(points), stats={"trend_points": len(points)})

    token = reddit.get_token(
        client,
        _cred(settings, settings.reddit_client_id, "REDDIT_CLIENT_ID"),
        _cred(settings, settings.reddit_client_secret, "REDDIT_CLIENT_SECRET"),
    )
    posts = [p for p in reddit.search(client, token, term) if p.created_at <= now]
    cluster = conn.execute(
        """SELECT to_id FROM entity_links WHERE from_type = 'keyword' AND from_id = %s AND to_type = 'product_cluster'
           ORDER BY confidence DESC NULLS LAST LIMIT 1""",
        (kid,),
    ).fetchone()
    new = 0
    with conn.cursor() as cur:
        for p in posts:
            cur.execute(
                """INSERT INTO reddit_mentions (post_id, subreddit, keyword_id, cluster_id, title, url, score, comments, created_at, captured_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (post_id) DO UPDATE SET score = EXCLUDED.score, comments = EXCLUDED.comments,
                     captured_at = EXCLUDED.captured_at
                   RETURNING (xmax = 0)""",
                (
                    p.post_id,
                    p.subreddit,
                    kid,
                    cluster[0] if cluster else None,
                    p.title,
                    p.url,
                    p.score,
                    p.comments,
                    p.created_at,
                    now,
                ),
            )
            res = cur.fetchone()
            new += int(bool(res and res[0]))
        # Dagtellingen opnieuw uit de tabel (idempotent, ook als posts op meerdere dagen binnenkomen)
        cur.execute(
            """SELECT created_at::date, count(*) FROM reddit_mentions
               WHERE keyword_id = %s AND created_at >= %s GROUP BY 1""",
            (kid, today - timedelta(days=7)),
        )
        counts = dict(cur.fetchall())
    conn.commit()
    _insert_signals(
        ch,
        [
            [kid, "reddit", "ALL", today - timedelta(days=b), float(counts.get(today - timedelta(days=b), 0))]
            for b in range(8)
        ],
    )
    return CrawlOutcome("succeeded", items=len(posts), stats={"reddit_posts": len(posts), "reddit_new": new})


def _series(ch: ClickHouse, kid: int, source: str, country: str, end: date) -> tuple[list[date], list[float]]:
    rows = ch.query(
        """SELECT date, argMax(value, updated_at) FROM keyword_signals_daily
           WHERE keyword_id = {k:UInt64} AND source = {s:String} AND country = {c:String}
             AND date > {start:Date} AND date <= {end:Date}
           GROUP BY date ORDER BY date""",
        parameters={"k": kid, "s": source, "c": country, "start": end - timedelta(days=HISTORY_DAYS), "end": end},
    ).result_rows
    # Ontbrekende dagen (bv. wekelijkse punten) vullen met de laatst bekende waarde
    if not rows:
        return [], []
    by_day = {r[0]: float(r[1]) for r in rows}
    days, values, last = [], [], float(rows[0][1])
    d = rows[0][0]
    while d <= end:
        last = by_day.get(d, last)
        days.append(d)
        values.append(last)
        d += timedelta(days=1)
    return days, values


def refresh_keyword(
    conn: psycopg.Connection[Any], ch: ClickHouse, kid: int, now: datetime, *, country: str, source: str = "search"
) -> None:
    src_country = country if source == "search" else "ALL"
    days, values = _series(ch, kid, source, src_country, now.date())
    if len(values) < 14:
        return
    g7, g30, phase = keyword_trend(values)
    peak, strength = seasonality(days, values)
    fc = forecast(values[-120:], days[-1])  # recente 4 maanden: het weekritme en de huidige trend
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE keywords SET interest = %s, growth_7d = %s, growth_30d = %s, phase = %s, peak_month = %s,
                 seasonality = %s, updated_at = %s WHERE id = %s""",
            (round(sum(values[-7:]) / 7, 1), g7, g30, phase, peak, strength, now, kid),
        )
        if fc:
            cur.execute(
                """INSERT INTO forecasts (entity_type, entity_id, source, computed_at, method, points, mape, trend_30d)
                   VALUES ('keyword', %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (entity_type, entity_id, source) DO UPDATE SET computed_at = EXCLUDED.computed_at,
                     method = EXCLUDED.method, points = EXCLUDED.points, mape = EXCLUDED.mape, trend_30d = EXCLUDED.trend_30d""",
                (kid, source, now, fc.method, Jsonb(fc.points), fc.mape, fc.trend_30d),
            )
    conn.commit()


def refresh_hashtags(conn: psycopg.Connection[Any], ch: ClickHouse, now: datetime, *, days: int = 90) -> dict[str, int]:
    """Hashtags uit ad-teksten (en video-captions) per dag tellen; vaak gebruikte tags worden keywords."""
    start = now.date() - timedelta(days=days)
    counts: dict[str, Counter[date]] = defaultdict(Counter)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT body AS text, start_date::date AS d FROM ads WHERE body ~ '#' AND start_date >= %s
               UNION ALL
               SELECT caption, posted_at::date FROM videos WHERE caption ~ '#' AND posted_at >= %s""",
            (start, start),
        )
        for r in cur.fetchall():
            for tag in {t.lower() for t in HASHTAG.findall(r["text"] or "")}:
                counts[tag][r["d"]] += 1
    created = 0
    rows: list[list[Any]] = []
    with conn.cursor() as cur:
        for tag, per_day in counts.items():
            if sum(per_day.values()) < MIN_HASHTAG_USES:
                continue
            cur.execute(
                """INSERT INTO keywords (term, language, kind, first_seen) VALUES (%s, 'und', 'hashtag', %s)
                   ON CONFLICT (term, language) DO UPDATE SET kind = 'hashtag' RETURNING id, (xmax = 0)""",
                (tag, min(per_day)),
            )
            res = cur.fetchone()
            assert res is not None
            kid, is_new = int(res[0]), bool(res[1])
            created += int(is_new)
            d = start
            while d <= now.date():
                rows.append([kid, "ads", "ALL", d, float(per_day.get(d, 0))])
                d += timedelta(days=1)
    conn.commit()
    _insert_signals(ch, rows)
    tags = conn.execute("SELECT id FROM keywords WHERE kind = 'hashtag'").fetchall()
    for (kid,) in tags:
        refresh_keyword(conn, ch, int(kid), now, country="ALL", source="ads")
    return {"hashtags": len(tags), "hashtags_new": created}
