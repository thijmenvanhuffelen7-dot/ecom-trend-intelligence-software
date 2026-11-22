"""RFC 822-berichten uitlezen: afzender, onderwerp, preheader, HTML/tekst, links en verzendplatform (ESP)."""

from __future__ import annotations

import html as htmllib
import re
from dataclasses import dataclass, field
from datetime import datetime
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import getaddresses, parseaddr, parsedate_to_datetime

ESP_HINTS = [
    ("Klaviyo", (r"klaviyomail\.com", r"klaviyo", r"x-kmail")),
    ("Omnisend", (r"omnisend", r"omnisrc")),
    ("Mailchimp", (r"mcsv\.net", r"mcdlv\.net", r"mailchimp", r"list-manage\.com")),
    ("Shopify Email", (r"shopifyemail", r"shopify_email", r"email\.shopify\.com")),
    ("Postscript", (r"postscript",)),
    ("Sendgrid", (r"sendgrid\.net",)),
]
HREF = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
TAG = re.compile(r"<[^>]+>")


@dataclass
class ParsedEmail:
    message_id: str
    sender: str
    sender_name: str | None
    to: list[str]
    subject: str
    received_at: datetime
    html: str | None
    text: str | None
    preheader: str | None
    links: list[str] = field(default_factory=list)
    esp: str | None = None
    list_unsubscribe: str | None = None


def html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", html)
    return re.sub(r"\s+", " ", htmllib.unescape(TAG.sub(" ", html))).strip()


def _preheader(html: str | None, text: str | None) -> str | None:
    if html:
        m = re.search(
            r"""(?is)<(?:div|span)[^>]*(?:display\s*:\s*none|class=["'][^"']*preheader)[^>]*>(.*?)</(?:div|span)>""",
            html,
        )
        if m:
            return html_to_text(m.group(1))[:200] or None
    source = text or (html_to_text(html) if html else "")
    return source[:140] or None


def detect_esp(msg: EmailMessage) -> str | None:
    blob = " ".join(f"{k}:{v}" for k, v in msg.items()).lower()
    for name, patterns in ESP_HINTS:
        if any(re.search(p, blob) for p in patterns):
            return name
    return None


def parse(raw: bytes, *, fallback_date: datetime) -> ParsedEmail:
    msg = message_from_bytes(raw, policy=policy.default)
    assert isinstance(msg, EmailMessage)
    name, addr = parseaddr(str(msg.get("From", "")))
    html_part = msg.get_body(preferencelist=("html",))
    text_part = msg.get_body(preferencelist=("plain",))
    html = html_part.get_content() if html_part is not None else None
    text = text_part.get_content() if text_part is not None else (html_to_text(html) if html else None)
    try:
        received = parsedate_to_datetime(str(msg["Date"])) if msg["Date"] else fallback_date
    except (TypeError, ValueError):
        received = fallback_date
    links = list(dict.fromkeys(u for u in HREF.findall(html or "") if u.startswith("http")))[:100]
    return ParsedEmail(
        message_id=str(msg.get("Message-ID", "")).strip() or f"<no-id-{hash(raw)}>",
        sender=addr.lower(),
        sender_name=name or None,
        to=[a.lower() for _, a in getaddresses([str(v) for v in msg.get_all("To", [])])],
        subject=str(msg.get("Subject", "")).strip()[:500],
        received_at=received,
        html=html,
        text=(text or "")[:20_000] or None,
        preheader=_preheader(html, text),
        links=links,
        esp=detect_esp(msg),
        list_unsubscribe=str(msg.get("List-Unsubscribe")) if msg.get("List-Unsubscribe") else None,
    )
