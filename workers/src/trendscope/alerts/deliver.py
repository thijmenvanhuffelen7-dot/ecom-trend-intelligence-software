"""Openstaande alert-bezorgingen versturen, met retries (exponentieel, max. 5) en bescherming tegen SSRF.

- Slack/Discord: incoming webhooks; Telegram: Bot API sendMessage; e-mail: Resend (of gelogd zonder sleutel).
- Generieke webhook: JSON, ondertekend met HMAC-SHA256 over "<timestamp>.<body>" in X-Trendscope-Signature.
- Vóór elk verzoek resolven we de host: privé-, loopback-, link-local- en metadata-adressen worden geweigerd.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx
import psycopg
from psycopg.rows import dict_row

from trendscope.core.crypto import decrypt_json
from trendscope.core.settings import Settings

MAX_ATTEMPTS = 5
TIMEOUT = 10.0


class UnsafeTarget(Exception):
    pass


def assert_public_https(url: str, *, resolve: bool = True) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise UnsafeTarget("alleen https zonder inloggegevens")
    if parts.port not in (None, 443):
        raise UnsafeTarget("alleen poort 443")
    if not resolve:
        return
    for info in socket.getaddrinfo(parts.hostname, 443, proto=socket.IPPROTO_TCP):
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise UnsafeTarget(f"{parts.hostname} wijst naar een niet-publiek adres")


def sign(secret: str, timestamp: int, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


@dataclass
class Delivery:
    id: int
    attempts: int
    channel_type: str
    config: dict[str, Any]
    event: dict[str, Any]


def _text(event: dict[str, Any], app_url: str) -> tuple[str, str]:
    payload = event["payload"]
    title = (payload.get("title") or {}).get("nl") or event.get("title") or "Melding"
    url = f"{app_url.rstrip('/')}{payload.get('url', '')}"
    return title, url


def render_payload(
    channel_type: str, config: dict[str, Any], event: dict[str, Any], app_url: str
) -> tuple[str, dict[str, str], bytes]:
    """(url, headers, body) per kanaaltype. Pure functie: makkelijk te testen."""
    title, link = _text(event, app_url)
    rule = event["payload"].get("rule", "")
    if channel_type == "slack":
        body: dict[str, Any] = {
            "text": f"{title} — {link}",
            "blocks": [
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*{title}*\n_{rule}_"}},
                {
                    "type": "actions",
                    "elements": [
                        {"type": "button", "text": {"type": "plain_text", "text": "Bekijk in Trendscope"}, "url": link}
                    ],
                },
            ],
        }
        return config["url"], {"Content-Type": "application/json"}, json.dumps(body).encode()
    if channel_type == "discord":
        body = {
            "content": None,
            "embeds": [{"title": title[:250], "url": link, "description": rule, "color": 0x22C55E}],
            "allowed_mentions": {"parse": []},
        }
        return config["url"], {"Content-Type": "application/json"}, json.dumps(body).encode()
    if channel_type == "telegram":
        from html import escape

        body = {
            "chat_id": config["chatId"],
            "text": f"<b>{escape(title)}</b>\n{escape(rule)}\n{escape(link)}",
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        return (
            f"https://api.telegram.org/bot{config['botToken']}/sendMessage",
            {"Content-Type": "application/json"},
            json.dumps(body).encode(),
        )
    if channel_type == "webhook":
        ts = int(time.time())
        body_bytes = json.dumps(
            {
                "type": "alert.triggered",
                "id": event["id"],
                "rule": rule,
                "title": title,
                "url": link,
                "entity": {"type": event.get("entity_type"), "id": event.get("entity_id")},
                "facts": event["payload"].get("facts", {}),
                "triggered_at": str(event["triggered_at"]),
            }
        ).encode()
        return (
            config["url"],
            {
                "Content-Type": "application/json",
                "X-Trendscope-Event": "alert.triggered",
                "X-Trendscope-Timestamp": str(ts),
                "X-Trendscope-Signature": sign(config["secret"], ts, body_bytes),
            },
            body_bytes,
        )
    raise ValueError(f"Onbekend kanaal {channel_type}")


def queue_email(conn: psycopg.Connection[Any], to: str, subject: str, html: str, kind: str) -> int:
    row = conn.execute(
        "INSERT INTO outbound_emails (to_address, subject, html, kind) VALUES (%s, %s, %s, %s) RETURNING id",
        (to, subject, html, kind),
    ).fetchone()
    assert row is not None
    return int(row[0])


def send_outbound_emails(conn: psycopg.Connection[Any], settings: Settings, client: httpx.Client) -> dict[str, int]:
    """Resend als er een sleutel is; anders 'logged' (zichtbaar in de database, handig in dev en tests)."""
    stats = {"sent": 0, "logged": 0, "failed": 0}
    rows = conn.execute(
        "SELECT id, to_address, subject, html FROM outbound_emails WHERE status = 'queued' ORDER BY id LIMIT 200"
    ).fetchall()
    for eid, to, subject, html in rows:
        if not settings.resend_api_key:
            conn.execute("UPDATE outbound_emails SET status = 'logged', sent_at = now() WHERE id = %s", (eid,))
            stats["logged"] += 1
            continue
        try:
            res = client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": settings.email_from, "to": [to], "subject": subject, "html": html},
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            conn.execute(
                "UPDATE outbound_emails SET status = 'sent', sent_at = now(), provider_id = %s WHERE id = %s",
                (res.json().get("id"), eid),
            )
            stats["sent"] += 1
        except httpx.HTTPError as exc:
            conn.execute(
                "UPDATE outbound_emails SET status = 'failed', error = %s WHERE id = %s", (str(exc)[:500], eid)
            )
            stats["failed"] += 1
    conn.commit()
    return stats


def deliver_pending(
    conn: psycopg.Connection[Any], settings: Settings, client: httpx.Client, now: datetime, *, resolve_dns: bool = True
) -> dict[str, int]:
    stats = {"sent": 0, "retry": 0, "failed": 0}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """SELECT d.id, d.attempts, c.type AS channel_type, c.config_enc, c.enabled,
                      e.id AS event_id, e.title, e.payload, e.entity_type::text, e.entity_id, e.triggered_at
               FROM alert_deliveries d JOIN notification_channels c ON c.id = d.channel_id JOIN alert_events e ON e.id = d.event_id
               WHERE d.status = 'pending' AND d.next_attempt_at <= %s ORDER BY d.id LIMIT 200 FOR UPDATE OF d SKIP LOCKED""",
            (now,),
        )
        rows = cur.fetchall()
    for r in rows:
        event = {
            "id": r["event_id"],
            "title": r["title"],
            "payload": r["payload"],
            "entity_type": r["entity_type"],
            "entity_id": r["entity_id"],
            "triggered_at": r["triggered_at"],
        }
        try:
            if not r["enabled"]:
                raise UnsafeTarget("kanaal uitgeschakeld")
            config = decrypt_json(r["config_enc"])
            if r["channel_type"] == "email":
                title, link = _text(event, settings.app_url)
                queue_email(
                    conn,
                    config["to"],
                    f"Trendscope: {title}",
                    f'<p><b>{title}</b></p><p><a href="{link}">Bekijk in Trendscope</a></p>',
                    "alert",
                )
            else:
                url, headers, body = render_payload(r["channel_type"], config, event, settings.app_url)
                assert_public_https(url, resolve=resolve_dns)
                res = client.post(url, headers=headers, content=body, timeout=TIMEOUT)
                if res.status_code >= 400:
                    raise httpx.HTTPStatusError(f"HTTP {res.status_code}", request=res.request, response=res)
            conn.execute(
                "UPDATE alert_deliveries SET status = 'sent', attempts = attempts + 1, sent_at = %s, last_error = NULL WHERE id = %s",
                (now, r["id"]),
            )
            conn.execute(
                "UPDATE notification_channels SET last_used_at = %s, last_error = NULL WHERE id = (SELECT channel_id FROM alert_deliveries WHERE id = %s)",
                (now, r["id"]),
            )
            stats["sent"] += 1
        except (httpx.HTTPError, UnsafeTarget, OSError, ValueError, KeyError) as exc:
            attempts = r["attempts"] + 1
            final = attempts >= MAX_ATTEMPTS or isinstance(exc, UnsafeTarget)
            # Nooit de URL of het token in de foutmelding: alleen het type fout
            message = f"{type(exc).__name__}: {str(exc)[:200]}" if isinstance(exc, UnsafeTarget) else type(exc).__name__
            conn.execute(
                """UPDATE alert_deliveries SET attempts = %s, last_error = %s, status = %s, next_attempt_at = %s WHERE id = %s""",
                (attempts, message, "failed" if final else "pending", now + timedelta(minutes=2**attempts), r["id"]),
            )
            conn.execute(
                "UPDATE notification_channels SET last_error = %s WHERE id = (SELECT channel_id FROM alert_deliveries WHERE id = %s)",
                (message, r["id"]),
            )
            stats["failed" if final else "retry"] += 1
        conn.commit()
    return stats
