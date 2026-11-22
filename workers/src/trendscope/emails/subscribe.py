"""Inschrijven op de nieuwsbrief van een winkel met een eigen seed-adres, zoals een bezoeker dat doet.

Shopify-winkels: het standaardformulier `POST /contact` met `form_type=customer` en de tag `newsletter`.
We omzeilen geen CAPTCHA of challenge: verschijnt die, dan wordt de inschrijving `manual` (een mens doet het).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from trendscope.core.http import PoliteHttpClient

CHALLENGE = re.compile(r"h-?captcha|recaptcha|/challenge|cf-chl|cf-turnstile|turnstile", re.I)


@dataclass(frozen=True)
class SubscribeResult:
    status: str  # subscribed | manual | failed
    detail: str | None = None


def subscribe_shopify(client: PoliteHttpClient, domain: str, address: str) -> SubscribeResult:
    try:
        res = client.post(
            f"https://{domain}/contact",
            data={"form_type": "customer", "utf8": "✓", "contact[email]": address, "contact[tags]": "newsletter"},
        )
    except httpx.HTTPStatusError as exc:
        return SubscribeResult("failed", f"HTTP {exc.response.status_code}")
    body = res.content[:200_000].decode("utf-8", "replace")
    if CHALLENGE.search(res.url) or CHALLENGE.search(body):
        return SubscribeResult("manual", "challenge/CAPTCHA: handmatig inschrijven")
    return SubscribeResult("subscribed")
