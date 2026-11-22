"""Integratie: alert-bezorging (versleutelde kanalen, ondertekende webhooks, retries) en digests. RUN_INTEGRATION=1.

De evaluatie van regels zelf zit in de web-app (TypeScript) en wordt end-to-end getest; hier testen we wat de worker doet.
"""

import hashlib
import hmac
import json
import os
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("RUN_INTEGRATION"), reason="zet RUN_INTEGRATION=1"),
]

NOW = datetime(2026, 11, 22, 9, 0, tzinfo=UTC)


@pytest.fixture()
def ws():
    from trendscope.core.settings import get_settings

    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        tag = uuid.uuid4().hex[:8]
        uid = conn.execute(
            "INSERT INTO users (email, digest, onboarded_at) VALUES (%s, 'daily', now()) RETURNING id",
            (f"alert-{tag}@t.dev",),
        ).fetchone()[0]
        wid = conn.execute(
            "INSERT INTO workspaces (name, slug, plan) VALUES ('Test', %s, 'pro') RETURNING id", (f"ws-{tag}",)
        ).fetchone()[0]
        conn.execute("INSERT INTO memberships (workspace_id, user_id, role) VALUES (%s, %s, 'owner')", (wid, uid))
        conn.commit()
        yield conn, settings, wid, uid
        conn.execute("DELETE FROM workspaces WHERE id = %s", (wid,))
        conn.execute("DELETE FROM users WHERE id = %s", (uid,))
        conn.commit()


def _event(conn, wid, channel_ids):
    from psycopg.types.json import Jsonb

    rid = conn.execute(
        "INSERT INTO alert_rules (workspace_id, name, rule) VALUES (%s, 'Sterk', %s) RETURNING id",
        (wid, Jsonb({"kind": "score_threshold", "metric": "validation", "value": 70})),
    ).fetchone()[0]
    eid = conn.execute(
        """INSERT INTO alert_events (rule_id, workspace_id, dedupe_key, entity_type, entity_id, title, payload)
           VALUES (%s, %s, 'pc:6:1', 'product_cluster', 6, 'Protein Pancake Mix', %s) RETURNING id""",
        (
            rid,
            wid,
            Jsonb(
                {"rule": "Sterk", "url": "/explorer/products/6", "title": {"nl": "Protein Pancake Mix: validatie 86"}}
            ),
        ),
    ).fetchone()[0]
    for cid in channel_ids:
        conn.execute("INSERT INTO alert_deliveries (event_id, channel_id) VALUES (%s, %s)", (eid, cid))
    conn.commit()
    return eid


def _channel(conn, wid, ctype, config):
    from trendscope.core.crypto import encrypt_json

    return conn.execute(
        "INSERT INTO notification_channels (workspace_id, type, name, config_enc, target_hint) VALUES (%s, %s, %s, %s, 'x') RETURNING id",
        (wid, ctype, ctype, encrypt_json(config)),
    ).fetchone()[0]


def test_signed_webhook_and_slack_are_delivered(ws):
    from trendscope.alerts.deliver import deliver_pending

    conn, settings, wid, _ = ws
    received: list[httpx.Request] = []
    hook = _channel(
        conn, wid, "webhook", {"type": "webhook", "url": "https://hooks.example.com/in", "secret": "s" * 20}
    )
    slack = _channel(conn, wid, "slack", {"type": "slack", "url": "https://hooks.slack.com/services/T/B/x"})
    _event(conn, wid, [hook, slack])
    client = httpx.Client(transport=httpx.MockTransport(lambda r: (received.append(r), httpx.Response(200))[1]))
    stats = deliver_pending(conn, settings, client, NOW, resolve_dns=False)
    assert stats["sent"] == 2
    wh = next(r for r in received if r.url.host == "hooks.example.com")
    ts = wh.headers["x-trendscope-timestamp"]
    assert (
        wh.headers["x-trendscope-signature"]
        == "sha256=" + hmac.new(b"s" * 20, f"{ts}.".encode() + wh.content, hashlib.sha256).hexdigest()
    )
    assert json.loads(wh.content)["url"].endswith("/explorer/products/6")
    # De config staat nooit leesbaar in de database
    assert (
        "hooks.slack.com"
        not in conn.execute("SELECT config_enc FROM notification_channels WHERE id = %s", (slack,)).fetchone()[0]
    )


def test_failures_retry_then_give_up(ws):
    from trendscope.alerts.deliver import MAX_ATTEMPTS, deliver_pending

    conn, settings, wid, _ = ws
    ch = _channel(conn, wid, "discord", {"type": "discord", "url": "https://discord.com/api/webhooks/1/x"})
    _event(conn, wid, [ch])
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    t = NOW
    for _ in range(MAX_ATTEMPTS):
        deliver_pending(conn, settings, client, t, resolve_dns=False)
        t += timedelta(hours=2)
    status, attempts, err = conn.execute(
        "SELECT d.status, d.attempts, d.last_error FROM alert_deliveries d JOIN notification_channels c ON c.id = d.channel_id WHERE c.id = %s",
        (ch,),
    ).fetchone()
    assert status == "failed" and attempts == MAX_ATTEMPTS
    assert "discord.com" not in (err or ""), "geen URL's (met tokens) in foutmeldingen"


def test_private_targets_are_refused(ws):
    from trendscope.alerts.deliver import deliver_pending

    conn, settings, wid, _ = ws
    ch = _channel(conn, wid, "webhook", {"type": "webhook", "url": "https://127.0.0.1/admin", "secret": "s" * 20})
    _event(conn, wid, [ch])
    called = []
    client = httpx.Client(transport=httpx.MockTransport(lambda r: (called.append(r), httpx.Response(200))[1]))
    stats = deliver_pending(conn, settings, client, NOW, resolve_dns=True)
    assert stats["failed"] == 1 and not called


def test_digest_is_queued_once_per_period(ws):
    from trendscope.alerts.deliver import send_outbound_emails
    from trendscope.alerts.digest import send_digests

    conn, settings, wid, uid = ws
    _event(conn, wid, [])
    first = send_digests(conn, settings, NOW)
    assert first["queued"] >= 1
    again = send_digests(conn, settings, NOW + timedelta(hours=2))
    assert again["queued"] == 0, "niet vaker dan de gekozen periode"
    email = conn.execute(
        "SELECT o.subject, o.html FROM outbound_emails o JOIN users u ON u.email = o.to_address WHERE u.id = %s", (uid,)
    ).fetchone()
    assert "Trendscope" in email[0] and "Protein Pancake Mix" in email[1]
    stats = send_outbound_emails(
        conn, settings, httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    )
    assert stats["logged"] >= 1, "zonder RESEND_API_KEY alleen loggen"
