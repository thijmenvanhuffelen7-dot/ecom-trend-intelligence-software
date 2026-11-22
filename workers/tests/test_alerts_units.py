"""Alerts: payloads per kanaal, HMAC-ondertekening, SSRF-bescherming en versleuteling (compatibel met Node)."""

import hashlib
import hmac
import json
from datetime import UTC, datetime

import pytest

from trendscope.alerts.deliver import UnsafeTarget, assert_public_https, render_payload, sign

EVENT = {
    "id": 7,
    "title": "Protein Pancake Mix: validatie 86 (> 70)",
    "payload": {
        "rule": "Sterke producten",
        "url": "/explorer/products/6",
        "title": {"nl": "Protein <b>Pancake</b>"},
        "facts": {"v": 86},
    },
    "entity_type": "product_cluster",
    "entity_id": 6,
    "triggered_at": datetime(2026, 11, 22, tzinfo=UTC),
}
NODE_TOKEN = (
    "v1:wi3wFNZVu4sCJ+xgfi+Q0v6emKLTPW8DsGPwyOi4UWuTN4yDpf0fUHhvMwR98p2+kcq5VTchyy+34+Txp+3X+gXg9DM6PrDf+8MXrDuU16VcG"
    "gOq1F7/JTD9XFSv8Ihho557gc05d2xSyd93"
)


def test_slack_discord_telegram_payloads():
    url, _, body = render_payload("slack", {"url": "https://hooks.slack.com/services/x"}, EVENT, "https://app.example")
    data = json.loads(body)
    assert url.startswith("https://hooks.slack.com") and "https://app.example/explorer/products/6" in data["text"]
    _, _, body = render_payload(
        "discord", {"url": "https://discord.com/api/webhooks/1/x"}, EVENT, "https://app.example"
    )
    assert json.loads(body)["allowed_mentions"] == {"parse": []}, "geen @everyone via een producttitel"
    url, _, body = render_payload("telegram", {"botToken": "123:abc", "chatId": "-100"}, EVENT, "https://app.example")
    assert url == "https://api.telegram.org/bot123:abc/sendMessage"
    assert "&lt;b&gt;Pancake&lt;/b&gt;" in json.loads(body)["text"], "HTML in titels wordt ge-escaped"


def test_webhook_signature_is_verifiable():
    url, headers, body = render_payload(
        "webhook", {"url": "https://example.com/hook", "secret": "topsecret"}, EVENT, "https://app.example"
    )
    ts = headers["X-Trendscope-Timestamp"]
    expected = "sha256=" + hmac.new(b"topsecret", f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    assert headers["X-Trendscope-Signature"] == expected == sign("topsecret", int(ts), body)
    assert json.loads(body)["entity"] == {"type": "product_cluster", "id": 6}


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/x",
        "https://user:pw@example.com/x",
        "https://example.com:8443/x",
        "https://127.0.0.1/x",
        "https://localhost/x",
    ],
)
def test_ssrf_guard_rejects(url):
    with pytest.raises(UnsafeTarget):
        assert_public_https(url)


def test_ssrf_guard_allows_public_without_dns_in_tests():
    assert_public_https("https://hooks.slack.com/services/x", resolve=False)


def test_crypto_roundtrip_and_node_compat(monkeypatch):
    from trendscope.core import crypto

    monkeypatch.delenv("APP_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("AUTH_SECRET", "test-secret")
    assert crypto.decrypt_json(crypto.encrypt_json({"a": [1, 2]})) == {"a": [1, 2]}
    assert crypto.decrypt_json(NODE_TOKEN)["secret"] == "s3cr3t-s3cr3t-s3cr3t", "token van apps/web/lib/crypto.ts"
    tampered = NODE_TOKEN[:-6] + ("AAAAAA" if not NODE_TOKEN.endswith("AAAAAA") else "BBBBBB")
    with pytest.raises(Exception):  # noqa: B017 — elke wijziging moet de authenticatie breken
        crypto.decrypt_json(tampered)
