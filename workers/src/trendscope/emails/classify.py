"""Type, kortingen en urgentie uit een marketingmail halen. Regels in NL/EN/DE; uitlegbaar en testbaar."""

from __future__ import annotations

import re
from dataclasses import dataclass

RULES: list[tuple[str, tuple[str, ...]]] = [
    (
        "confirmation",
        (
            r"confirm (your|my) (subscription|email)",
            r"bevestig je (inschrijving|aanmelding|e-?mail)",
            r"please confirm",
            r"bestätige",
        ),
    ),
    (
        "welcome",
        (
            r"\bwelcome\b",
            r"\bwelkom\b",
            r"\bwillkommen\b",
            r"thanks for (subscribing|signing up|joining)",
            r"bedankt voor je inschrijving",
        ),
    ),
    (
        "abandoned_cart",
        (
            r"left (something|items?) in your cart",
            r"forgot something",
            r"still in your cart",
            r"winkelmand(je)?",
            r"warenkorb",
        ),
    ),
    (
        "transactional",
        (r"order (confirmation|#?\d+)", r"your order", r"bestelling", r"shipping confirmation", r"verzonden"),
    ),
    (
        "product_launch",
        (
            r"\bnew\b.*\b(arrival|drop|launch|in)\b",
            r"just (dropped|landed|launched)",
            r"\bnieuw(e)?\b",
            r"back in stock",
            r"weer op voorraad",
        ),
    ),
]
PERCENT = re.compile(r"(\d{1,2})\s?%\s*(?:off|korting|rabatt|discount)|(?:save|bespaar|spaar)\s*(\d{1,2})\s?%", re.I)
CODE = re.compile(r"(?:code|coupon|kortingscode)[:\s]+[\"'“]?([A-Z0-9]{4,20})\b")
FREE_SHIPPING = re.compile(r"free (shipping|delivery)|gratis (verzending|bezorging)|kostenloser versand", re.I)
URGENCY = re.compile(
    r"last chance|laatste kans|ends (tonight|today|soon|at midnight)|eindigt (vanavond|vandaag)|only \d+ (hours|left)|nog maar \d+|final hours|letzte chance",
    re.I,
)
PROMO = re.compile(r"\bsale\b|% ?off|korting|uitverkoop|black friday|cyber monday|deal|rabatt|promo", re.I)


@dataclass(frozen=True)
class Classified:
    type: str
    discount_pct: float | None
    discount_code: str | None
    free_shipping: bool
    urgency: bool


def classify(subject: str, text: str | None) -> Classified:
    body = (text or "")[:5000]
    blob = f"{subject}\n{body}"
    pcts = [int(a or b) for a, b in PERCENT.findall(blob)]
    discount = float(max(pcts)) if pcts else None
    code_match = CODE.search(blob)
    kind = "other"
    for name, patterns in RULES:
        if any(re.search(p, subject, re.I) for p in patterns):
            kind = name
            break
    if kind == "other":
        if discount or PROMO.search(subject):
            kind = "promotion"
        elif any(re.search(p, body, re.I) for p in RULES[4][1]):
            kind = "product_launch"
        elif len(body) > 400:
            kind = "newsletter"
    return Classified(
        type=kind,
        discount_pct=discount,
        discount_code=code_match.group(1) if code_match else None,
        free_shipping=bool(FREE_SHIPPING.search(blob)),
        urgency=bool(URGENCY.search(blob)),
    )
