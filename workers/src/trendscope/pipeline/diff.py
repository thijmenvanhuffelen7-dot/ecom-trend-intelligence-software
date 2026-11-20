"""Wijzigingsdetectie tussen twee crawls van dezelfde catalogus. Puur: geen I/O."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class VariantState:
    id: str
    title: str
    price: Decimal
    available: bool


@dataclass(frozen=True)
class ProductState:
    external_id: str
    handle: str
    title: str
    price: Decimal | None
    compare_at_price: Decimal | None
    available: bool
    variants: tuple[VariantState, ...] = ()
    image: str | None = None


@dataclass(frozen=True)
class ChangeEvent:
    type: str
    external_id: str
    payload: dict[str, Any] = field(default_factory=dict)


# Prijsverschillen kleiner dan dit (bv. afronding of valuta-ruis) negeren we
PRICE_EPSILON = Decimal("0.005")


def _num(d: Decimal | None) -> float | None:
    return float(d) if d is not None else None


def diff_catalog(previous: Mapping[str, ProductState], current: Mapping[str, ProductState]) -> list[ChangeEvent]:
    """Events in een stabiele volgorde: toegevoegd, verwijderd, daarna wijzigingen per product."""
    events: list[ChangeEvent] = []
    for pid in sorted(current.keys() - previous.keys()):
        p = current[pid]
        events.append(
            ChangeEvent(
                "product_added", pid, {"title": p.title, "price": _num(p.price), "image": p.image, "handle": p.handle}
            )
        )
    for pid in sorted(previous.keys() - current.keys()):
        p = previous[pid]
        events.append(ChangeEvent("product_removed", pid, {"title": p.title, "price": _num(p.price), "image": p.image}))

    for pid in sorted(previous.keys() & current.keys()):
        old, new = previous[pid], current[pid]
        base = {"title": new.title, "image": new.image}
        if old.price is not None and new.price is not None and abs(new.price - old.price) > PRICE_EPSILON:
            pct = float((new.price - old.price) / old.price * 100) if old.price else None
            events.append(
                ChangeEvent(
                    "price_changed",
                    pid,
                    base
                    | {
                        "old": _num(old.price),
                        "new": _num(new.price),
                        "pct": round(pct, 1) if pct is not None else None,
                    },
                )
            )
        if (old.compare_at_price or Decimal(0)) != (new.compare_at_price or Decimal(0)):
            events.append(
                ChangeEvent(
                    "compare_at_changed",
                    pid,
                    base | {"old": _num(old.compare_at_price), "new": _num(new.compare_at_price)},
                )
            )
        if old.available and not new.available:
            events.append(ChangeEvent("out_of_stock", pid, base))
        elif not old.available and new.available:
            events.append(ChangeEvent("back_in_stock", pid, base))
        old_v = {v.id for v in old.variants}
        new_v = {v.id for v in new.variants}
        if new_v - old_v:
            events.append(
                ChangeEvent(
                    "variants_added",
                    pid,
                    base | {"variants": sorted(v.title for v in new.variants if v.id in new_v - old_v)},
                )
            )
        if old_v - new_v:
            events.append(
                ChangeEvent(
                    "variants_removed",
                    pid,
                    base | {"variants": sorted(v.title for v in old.variants if v.id in old_v - new_v)},
                )
            )
        if old.title != new.title:
            events.append(ChangeEvent("title_changed", pid, base | {"old": old.title, "new": new.title}))
    return events


def diff_technologies(previous: set[str], current: set[str]) -> list[ChangeEvent]:
    """Technologieën op naam vergelijken (een herclassificatie van type is geen wijziging)."""
    return [ChangeEvent("tech_added", name, {"name": name}) for name in sorted(current - previous)] + [
        ChangeEvent("tech_removed", name, {"name": name}) for name in sorted(previous - current)
    ]
