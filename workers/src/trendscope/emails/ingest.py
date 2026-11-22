"""Seed-mailboxen: inschrijven op nieuwsbrieven en binnengekomen mails verwerken.

- Elke winkel krijgt een eigen plus-adres (`inbox+s<store_id>@domein`), zodat elke mail aan een winkel hangt.
- Mails worden idempotent ingelezen (Message-ID uniek), geclassificeerd en aan producten gekoppeld via /products/<handle>.
- Per winkel: mails per week (4 weken), gemiddelde korting en verzendplatform.
We slaan geen persoonsgegevens van eindklanten op: de mailbox is van ons en ontvangt alleen marketingmail.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

import psycopg
from psycopg.types.json import Jsonb

from trendscope.core.http import PoliteHttpClient
from trendscope.core.settings import Settings
from trendscope.emails.classify import classify
from trendscope.emails.mailsource import MailSource, StaticSource
from trendscope.emails.parse import html_to_text, parse
from trendscope.emails.subscribe import subscribe_shopify

PRODUCT_PATH = re.compile(r"^/products/([a-z0-9][a-z0-9-]*)", re.I)


def mailbox_address(settings: Settings) -> str:
    return f"{settings.email_seed_local}@{settings.email_seed_domain}"


def plus_address(settings: Settings, store_id: int) -> str:
    return f"{settings.email_seed_local}+s{store_id}@{settings.email_seed_domain}"


def ensure_mailbox(conn: psycopg.Connection[Any], settings: Settings) -> int:
    row = conn.execute(
        """INSERT INTO mailboxes (address) VALUES (%s)
           ON CONFLICT (address) DO UPDATE SET is_active = true RETURNING id""",
        (mailbox_address(settings),),
    ).fetchone()
    conn.commit()
    assert row is not None
    return int(row[0])


def stores_to_track(conn: psycopg.Connection[Any], limit: int) -> list[tuple[int, str]]:
    """Gevolgde winkels (watchlists) eerst, aangevuld met de grootste winkels; alleen winkels met een e-mailtool."""
    rows = conn.execute(
        """SELECT s.id, s.domain FROM stores s
           WHERE s.platform = 'shopify' AND NOT EXISTS (SELECT 1 FROM email_subscriptions e WHERE e.store_id = s.id)
             AND EXISTS (SELECT 1 FROM store_technologies t WHERE t.store_id = s.id AND t.type = 'email' AND t.removed_at IS NULL)
           ORDER BY EXISTS (SELECT 1 FROM watchlists w WHERE w.entity_type = 'store' AND w.entity_id = s.id) DESC,
                    s.monthly_visits DESC NULLS LAST, s.id
           LIMIT %s""",
        (limit,),
    ).fetchall()
    return [(int(r[0]), str(r[1])) for r in rows]


def subscribe_stores(
    conn: psycopg.Connection[Any],
    client: PoliteHttpClient,
    settings: Settings,
    now: datetime,
    *,
    limit: int | None = None,
) -> dict[str, int]:
    mailbox_id = ensure_mailbox(conn, settings)
    counts = {"subscribed": 0, "manual": 0, "failed": 0}
    for store_id, domain in stores_to_track(conn, limit or settings.email_track_stores):
        address = plus_address(settings, store_id)
        result = subscribe_shopify(client, domain, address)
        counts[result.status] = counts.get(result.status, 0) + 1
        conn.execute(
            """INSERT INTO email_subscriptions (store_id, mailbox_id, address, status, method, error, subscribed_at)
               VALUES (%s, %s, %s, %s, 'shopify_form', %s, %s) ON CONFLICT (store_id, mailbox_id) DO NOTHING""",
            (
                store_id,
                mailbox_id,
                address,
                result.status,
                result.detail,
                now if result.status == "subscribed" else None,
            ),
        )
    conn.commit()
    return counts


def _product_links(
    conn: psycopg.Connection[Any], store_id: int | None, domain: str | None, links: Sequence[str]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    handles: dict[str, str] = {}
    for url in links:
        parts = urlsplit(url)
        m = PRODUCT_PATH.match(parts.path)
        if m and domain and parts.netloc.removeprefix("www.") == domain:
            handles[url] = m.group(1)
    ids: dict[str, int] = {}
    if handles and store_id:
        ids = {
            str(h): int(pid)
            for pid, h in conn.execute(
                "SELECT id, handle FROM products WHERE store_id = %s AND handle = ANY(%s)",
                (store_id, list(set(handles.values()))),
            )
        }
    for url in links[:30]:
        entry: dict[str, Any] = {"url": url}
        if url in handles and handles[url] in ids:
            entry["product_id"] = ids[handles[url]]
        out.append(entry)
    return out


def sync_mailbox(conn: psycopg.Connection[Any], source: MailSource, mailbox_id: int, now: datetime) -> dict[str, int]:
    row = conn.execute("SELECT last_uid FROM mailboxes WHERE id = %s", (mailbox_id,)).fetchone()
    last_uid = int(row[0]) if row else 0
    subs = {
        str(a): (int(sid), int(store), str(domain))
        for sid, a, store, domain in conn.execute(
            """SELECT e.id, e.address, e.store_id, s.domain FROM email_subscriptions e JOIN stores s ON s.id = e.store_id
               WHERE e.mailbox_id = %s""",
            (mailbox_id,),
        )
    }
    stats = {"fetched": 0, "new": 0, "unmatched": 0}
    touched: set[int] = set()
    for uid, raw in source.fetch(last_uid):
        stats["fetched"] += 1
        mail = parse(raw, fallback_date=now)
        sub = next((subs[t] for t in mail.to if t in subs), None)
        if sub is None:
            stats["unmatched"] += 1
        sub_id, store_id, domain = sub if sub else (None, None, None)
        # Het platte-tekstdeel is in marketingmail vaak een stub; de inhoud staat in de HTML
        html_text = html_to_text(mail.html) if mail.html else ""
        body = html_text if len(html_text) > len(mail.text or "") else (mail.text or "")
        c = classify(mail.subject, body)
        inserted = conn.execute(
            """INSERT INTO emails (message_id, store_id, subscription_id, received_at, sender, sender_name, subject, preheader,
                 body_html, body_text, type, discount_pct, discount_code, free_shipping, urgency, links, esp)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (message_id) DO NOTHING RETURNING id""",
            (
                mail.message_id,
                store_id,
                sub_id,
                mail.received_at,
                mail.sender,
                mail.sender_name,
                mail.subject,
                mail.preheader,
                (mail.html or "")[:500_000] or None,
                body[:20_000] or None,
                c.type,
                c.discount_pct,
                c.discount_code,
                c.free_shipping,
                c.urgency,
                Jsonb(_product_links(conn, store_id, domain, mail.links)),
                mail.esp,
            ),
        ).fetchone()
        if inserted:
            stats["new"] += 1
            if store_id:
                touched.add(store_id)
            if sub_id and c.type in ("welcome", "confirmation"):
                # Ontvangst van de bevestigings-/welkomstmail = inschrijving actief (double opt-in via onze eigen inbox)
                conn.execute(
                    "UPDATE email_subscriptions SET status = 'confirmed', confirmed_at = coalesce(confirmed_at, %s) WHERE id = %s",
                    (mail.received_at, sub_id),
                )
        last_uid = max(last_uid, uid)
    conn.execute("UPDATE mailboxes SET last_uid = %s, last_sync = %s WHERE id = %s", (last_uid, now, mailbox_id))
    for store_id in sorted(touched):
        conn.execute(
            """UPDATE stores SET
                 emails_per_week = (SELECT count(*) / 4.0 FROM emails WHERE store_id = %(s)s AND received_at > %(now)s - interval '28 days'
                                     AND type NOT IN ('confirmation', 'transactional')),
                 avg_discount_pct = (SELECT avg(discount_pct) FROM emails WHERE store_id = %(s)s AND discount_pct IS NOT NULL),
                 email_esp = coalesce((SELECT esp FROM emails WHERE store_id = %(s)s AND esp IS NOT NULL
                                       ORDER BY received_at DESC LIMIT 1), email_esp)
               WHERE id = %(s)s""",
            {"s": store_id, "now": now},
        )
    conn.commit()
    return stats


def mock_source(conn: psycopg.Connection[Any], day: int) -> MailSource:
    """Alle mails die de mockwinkels tot en met `day` naar onze plus-adressen sturen."""
    from trendscope.mockweb.baseline import load_baseline
    from trendscope.mockweb.email_world import emails_for

    day0 = load_baseline().day0
    msgs: list[tuple[int, bytes]] = []
    for address, domain, subscribed_at in conn.execute(
        """SELECT e.address, s.domain, e.subscribed_at FROM email_subscriptions e JOIN stores s ON s.id = e.store_id
           WHERE e.status IN ('subscribed', 'confirmed') AND e.subscribed_at IS NOT NULL"""
    ):
        sub_day = (subscribed_at.date() - day0).days
        msgs += emails_for(str(domain), str(address), sub_day, day)
    return StaticSource(msgs)


def run_email_cycle(
    conn: psycopg.Connection[Any],
    settings: Settings,
    now: datetime,
    *,
    client: PoliteHttpClient,
    source: MailSource,
    subscribe: bool = True,
) -> dict[str, int]:
    out: dict[str, int] = {}
    if subscribe:
        out.update({f"subscribe_{k}": v for k, v in subscribe_stores(conn, client, settings, now).items()})
    mailbox_id = ensure_mailbox(conn, settings)
    out.update({f"mail_{k}": v for k, v in sync_mailbox(conn, source, mailbox_id, now).items()})
    return out
