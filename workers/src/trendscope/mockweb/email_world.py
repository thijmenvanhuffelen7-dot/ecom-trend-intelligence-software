"""Marketingmails van de demowinkels, als echte RFC 822-berichten, vanaf de dag van inschrijving.

Elke winkel heeft een vaste cadans (1–5 mails per week) en een kortingsstijl. Op de inschrijfdag komt een
bevestigings- en welkomstmail; daarna promoties, lanceringen (met echte productlinks uit de catalogus) en nieuwsbrieven.
"""

from __future__ import annotations

import random
import zlib
from datetime import UTC, datetime, time, timedelta
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from typing import Any

from trendscope.mockweb.baseline import StoreBaseline, load_baseline
from trendscope.mockweb.world import catalog

ESPS = {
    "Klaviyo": ("klaviyomail.com", "X-Kmail-Account"),
    "Omnisend": ("omnisend.com", "X-Omnisend-Campaign"),
    "Mailchimp": ("mcsv.net", "X-MC-User"),
}


def _crc(*p: object) -> int:
    return zlib.crc32(":".join(map(str, p)).encode())


def _esp(store: StoreBaseline) -> str:
    for name in ("Klaviyo", "Omnisend", "Mailchimp"):
        if name in store.technologies:
            return name
    return ("Klaviyo", "Omnisend", "Mailchimp")[_crc(store.domain) % 3]


def needs_challenge(domain: str) -> bool:
    """Een deel van de winkels toont een CAPTCHA bij inschrijven → handmatig."""
    return _crc(domain, "captcha") % 10 == 0


def _message(store: StoreBaseline, to: str, when: datetime, subject: str, html: str, n: int) -> EmailMessage:
    esp = _esp(store)
    host, header = ESPS[esp]
    msg = EmailMessage()
    msg["From"] = f"{store.name} <hello@{store.domain}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = format_datetime(when)
    msg["Message-ID"] = make_msgid(idstring=f"{_crc(store.domain, n)}", domain=host)
    msg["List-Unsubscribe"] = f"<https://{host}/unsubscribe/{_crc(to)}>"
    msg[header] = str(_crc(store.domain))
    msg["Return-Path"] = f"bounce@{host}"
    msg.set_content(subject)
    msg.add_alternative(html, subtype="html")
    return msg


def _html(store: StoreBaseline, preheader: str, title: str, body: str, products: list[dict[str, Any]], cta: str) -> str:
    cards = "".join(
        f'<td style="padding:8px;text-align:center"><a href="https://{store.domain}/products/{p["handle"]}">'
        f'<img src="{p["image"]}" width="160" alt=""/><br/>{p["title"]}</a><br/><b>€{p["price"]}</b></td>'
        for p in products[:3]
    )
    return (
        f'<html><body style="font-family:Helvetica,Arial;background:#f6f6f6;margin:0">'
        f'<div style="display:none;max-height:0;overflow:hidden">{preheader}</div>'
        f'<table width="600" align="center" style="background:#fff"><tr><td style="padding:24px;background:{store.color};color:#fff">'
        f'<h2 style="margin:0">{store.name}</h2></td></tr>'
        f'<tr><td style="padding:24px"><h1 style="font-size:26px">{title}</h1><p>{body}</p>'
        f'<p><a href="https://{store.domain}/collections/all" style="background:#111;color:#fff;padding:12px 20px;'
        f'text-decoration:none;border-radius:6px">{cta}</a></p></td></tr>'
        f"<tr><td><table><tr>{cards}</tr></table></td></tr>"
        f'<tr><td style="padding:16px;font-size:11px;color:#888">You are receiving this because you signed up at '
        f'{store.domain}. <a href="https://{store.domain}/unsubscribe">Unsubscribe</a></td></tr></table>'
        f'<img src="https://{ESPS[_esp(store)][0]}/open.gif?u={_crc(store.domain)}" width="1" height="1"/></body></html>'
    )


def emails_for(domain: str, to: str, subscribed_day: int, until_day: int) -> list[tuple[int, bytes]]:
    """(uid, rfc822) voor alle mails van een winkel aan `to`, van de inschrijfdag t/m `until_day`."""
    store = next((s for s in load_baseline().stores if s.domain == domain), None)
    if store is None:
        return []
    day0 = load_baseline().day0
    r = random.Random(f"mail:{domain}")
    per_week = 1 + _crc(domain, "cadence") % 5
    style = r.choice([10, 15, 20, 25, 30, 40])
    out: list[tuple[int, bytes]] = []
    n = 0

    def add(day: int, hour: int, subject: str, html: str) -> None:
        nonlocal n
        when = datetime.combine(day0 + timedelta(days=day), time(hour, 5 + n % 50), tzinfo=UTC)
        uid = (day + 100) * 100_000 + (_crc(domain) % 1000) * 100 + n
        out.append((uid, _message(store, to, when, subject, html, n).as_bytes()))
        n += 1

    prods = catalog(domain, subscribed_day)[:12] or []

    def pick(k: int) -> list[dict[str, Any]]:
        return [p for i, p in enumerate(prods) if (i + k) % 4 == 0][:3]

    add(
        subscribed_day,
        10,
        f"Please confirm your subscription to {store.name}",
        _html(
            store,
            "One click and you're in",
            "Confirm your email",
            "Tap below to confirm your subscription.",
            [],
            "Confirm subscription",
        ),
    )
    add(
        subscribed_day,
        11,
        f"Welcome to {store.name}! Here's {style}% off your first order",
        _html(
            store,
            f"Use code WELCOME{style} at checkout",
            f"Welcome! Enjoy {style}% off",
            f"Use code WELCOME{style} at checkout. Free shipping on orders over €50.",
            pick(0),
            "Shop now",
        ),
    )
    for day in range(subscribed_day + 1, until_day + 1):
        if _crc(domain, "send", day) % 7 >= per_week:
            continue
        kind = _crc(domain, "kind", day) % 10
        items = catalog(domain, day)[:12] or prods
        sel = [p for i, p in enumerate(items) if (i + day) % 4 == 0][:3]
        if kind < 5:
            pct = style + (10 if kind == 0 else 0)
            urgent = kind in (0, 1)
            subject = (
                f"⏰ Last chance: {pct}% off ends tonight" if urgent else f"{pct}% off everything — this weekend only"
            )
            add(
                day,
                18,
                subject,
                _html(
                    store,
                    f"Code SAVE{pct} • free shipping",
                    subject,
                    f"Save {pct}% with code SAVE{pct}. Free shipping today.",
                    sel,
                    "Claim my discount",
                ),
            )
        elif kind < 8 and sel:
            subject = f"Just dropped: {sel[0]['title'].split(' — ')[0]}"
            add(
                day,
                9,
                subject,
                _html(
                    store,
                    "New in — limited stock",
                    subject,
                    "Our newest arrival is here. Be the first.",
                    sel,
                    "Shop the drop",
                ),
            )
        else:
            subject = f"{store.name} journal: 3 ways to use your favourites"
            add(
                day,
                8,
                subject,
                _html(
                    store,
                    "Tips, stories and what's new",
                    subject,
                    ("Our favourite tips this week. " * 30).strip(),
                    sel,
                    "Read more",
                ),
            )
    return out
