"""E-mail: parsen, ESP-herkenning, classificatie (NL/EN), kortingen en de mock-cadans. Geen netwerk of database."""

from datetime import UTC, datetime
from email.message import EmailMessage

import pytest

from trendscope.emails.classify import classify
from trendscope.emails.mailsource import StaticSource
from trendscope.emails.parse import html_to_text, parse
from trendscope.emails.subscribe import CHALLENGE

NOW = datetime(2026, 11, 20, tzinfo=UTC)


def _mail(subject: str, html: str, headers: dict[str, str] | None = None) -> bytes:
    m = EmailMessage()
    m["From"] = "Glowly <hello@glowly.example>"
    m["To"] = "inbox+s12@seeds.trendscope.example"
    m["Subject"] = subject
    m["Date"] = "Thu, 19 Nov 2026 18:05:00 +0000"
    m["Message-ID"] = "<abc@klaviyomail.com>"
    for k, v in (headers or {}).items():
        m[k] = v
    m.set_content("tekst")
    m.add_alternative(html, subtype="html")
    return m.as_bytes()


def test_parse_extracts_preheader_links_and_esp():
    raw = _mail(
        "25% off everything",
        '<div style="display:none">Code SAVE25 inside</div><a href="https://glowly.example/products/serum-1">x</a>'
        '<a href="mailto:x@y">m</a><script>alert(1)</script>',
        {"X-Kmail-Account": "1", "Return-Path": "bounce@klaviyomail.com"},
    )
    p = parse(raw, fallback_date=NOW)
    assert p.sender == "hello@glowly.example" and p.sender_name == "Glowly"
    assert p.to == ["inbox+s12@seeds.trendscope.example"]
    assert p.preheader == "Code SAVE25 inside"
    assert p.links == ["https://glowly.example/products/serum-1"]
    assert p.esp == "Klaviyo"
    assert p.received_at.year == 2026 and p.received_at.tzinfo is not None
    assert "alert" not in html_to_text("<p>hi</p><script>alert(1)</script>")


@pytest.mark.parametrize(
    ("subject", "body", "kind"),
    [
        ("Please confirm your subscription to Glowly", "", "confirmation"),
        ("Welkom bij Glowly! Hier is 10% korting", "Gebruik code WELKOM10", "welcome"),
        ("You left something in your cart", "", "abandoned_cart"),
        ("Just dropped: Glow Serum", "", "product_launch"),
        ("⏰ Last chance: 30% off ends tonight", "Code SAVE30", "promotion"),
        ("Glowly journal", "lang verhaal " * 60, "newsletter"),
        ("Your order #1234 is confirmed", "", "transactional"),
    ],
)
def test_classify_types(subject, body, kind):
    assert classify(subject, body).type == kind


def test_discounts_codes_and_urgency():
    c = classify(
        "⏰ Last chance: 30% off ends tonight", "Save 30% with code SAVE30. Free shipping today. Of 15% korting."
    )
    assert c.discount_pct == 30 and c.discount_code == "SAVE30" and c.free_shipping and c.urgency
    c2 = classify("Nieuwe collectie", "Bekijk onze nieuwe items")
    assert c2.discount_pct is None and c2.discount_code is None and not c2.urgency


def test_static_source_is_incremental():
    src = StaticSource([(3, b"c"), (1, b"a"), (2, b"b")])
    assert [u for u, _ in src.fetch(0)] == [1, 2, 3]
    assert [u for u, _ in src.fetch(2)] == [3]


def test_captcha_detection_means_manual():
    assert CHALLENGE.search('<div class="h-captcha" data-sitekey="x">')
    assert CHALLENGE.search("https://shop.example/challenge?x=1")
    assert not CHALLENGE.search("<p>Thanks for subscribing</p>")
