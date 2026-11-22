"""Dagelijkse/wekelijkse digest per gebruiker: nieuwe meldingen, sterkste kansen in de eigen niches, opkomende zoektermen.

Per gebruiker één mail per periode (digest_last_sent). HTML is eenvoudig en tabelgebaseerd (werkt in alle mailclients);
alle waarden worden ge-escaped.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from html import escape
from typing import Any

import psycopg
from psycopg.rows import dict_row

from trendscope.alerts.deliver import queue_email
from trendscope.core.settings import Settings

PERIOD = {"daily": timedelta(days=1), "weekly": timedelta(days=7)}


def due_users(conn: psycopg.Connection[Any], now: datetime) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT u.id, u.email, u.locale, u.digest, u.digest_last_sent, m.workspace_id, w.niches
               FROM users u JOIN memberships m ON m.user_id = u.id JOIN workspaces w ON w.id = m.workspace_id
               WHERE u.digest <> 'off' AND u.onboarded_at IS NOT NULL
                 AND (u.digest_last_sent IS NULL OR u.digest_last_sent < %s - CASE u.digest WHEN 'daily' THEN interval '23 hours'
                                                                                     ELSE interval '167 hours' END)""",
            (now,),
        )
        return list(cur.fetchall())


def build_digest(
    conn: psycopg.Connection[Any], user: dict[str, Any], now: datetime, app_url: str
) -> tuple[str, str] | None:
    since = user["digest_last_sent"] or now - PERIOD[user["digest"]]
    nl = (user.get("locale") or "nl") == "nl"
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT title, payload->>'url' AS url FROM alert_events WHERE workspace_id = %s AND triggered_at > %s
               ORDER BY triggered_at DESC LIMIT 10""",
            (user["workspace_id"], since),
        )
        events = cur.fetchall()
        cur.execute(
            """SELECT c.id, c.canonical_title, s.opportunity, s.phase::text FROM scores s
               JOIN product_clusters c ON c.id = s.entity_id LEFT JOIN niches n ON n.id = c.niche_id
               WHERE s.entity_type = 'product_cluster' AND (cardinality(%s::text[]) = 0 OR n.slug = ANY(%s::text[]))
               ORDER BY s.opportunity DESC LIMIT 5""",
            (user["niches"] or [], user["niches"] or []),
        )
        top = cur.fetchall()
        cur.execute(
            "SELECT id, term, growth_30d FROM keywords WHERE kind = 'keyword' AND phase = 'emerging' ORDER BY growth_30d DESC NULLS LAST LIMIT 5"
        )
        keywords = cur.fetchall()
    if not events and not top:
        return None
    base = app_url.rstrip("/")

    def section(title: str, items: list[str]) -> str:
        if not items:
            return ""
        lis = "".join(f'<tr><td style="padding:6px 0;border-bottom:1px solid #eee">{i}</td></tr>' for i in items)
        return f'<h3 style="margin:24px 0 8px;font-size:15px">{escape(title)}</h3><table width="100%">{lis}</table>'

    html = (
        '<table width="600" align="center" style="font-family:Helvetica,Arial;color:#111"><tr><td>'
        f'<h2 style="margin:0">Trendscope — {"jouw" if nl else "your"} {("dag" if user["digest"] == "daily" else "week") if nl else ("day" if user["digest"] == "daily" else "week")}</h2>'
        + section(
            "Nieuwe meldingen" if nl else "New alerts",
            [f'<a href="{base}{escape(e["url"] or "")}">{escape(e["title"] or "")}</a>' for e in events],
        )
        + section(
            "Sterkste kansen in jouw niches" if nl else "Top opportunities in your niches",
            [
                f'<a href="{base}/explorer/products/{t["id"]}">{escape(t["canonical_title"])}</a> — {round(t["opportunity"])} ({escape(t["phase"])})'
                for t in top
            ],
        )
        + section(
            "Opkomende zoektermen" if nl else "Emerging search terms",
            [
                f'<a href="{base}/trends/{k["id"]}">{escape(k["term"])}</a> +{round(k["growth_30d"] or 0)}%'
                for k in keywords
            ],
        )
        + f'<p style="margin-top:24px;font-size:12px;color:#888"><a href="{base}/alerts">{"Instellingen voor deze mail" if nl else "Settings for this email"}</a></p>'
        "</td></tr></table>"
    )
    subject = (
        ("Je dagelijkse Trendscope-update" if user["digest"] == "daily" else "Je wekelijkse Trendscope-update")
        if nl
        else ("Your daily Trendscope update" if user["digest"] == "daily" else "Your weekly Trendscope update")
    )
    return subject, html


def send_digests(conn: psycopg.Connection[Any], settings: Settings, now: datetime) -> dict[str, int]:
    stats = {"queued": 0, "skipped_empty": 0}
    for user in due_users(conn, now):
        built = build_digest(conn, user, now, settings.app_url)
        if built is None:
            stats["skipped_empty"] += 1
        else:
            queue_email(conn, user["email"], built[0], built[1], "digest")
            stats["queued"] += 1
        conn.execute("UPDATE users SET digest_last_sent = %s WHERE id = %s", (now, user["id"]))
        conn.commit()
    return stats
