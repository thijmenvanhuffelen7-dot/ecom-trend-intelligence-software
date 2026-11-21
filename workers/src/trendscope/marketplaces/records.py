"""Genormaliseerde marktplaatslisting (AliExpress, Amazon, CJ)."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from trendscope.pipeline.hashing import content_hash

Source = Literal["aliexpress", "amazon", "cj"]


class Listing(BaseModel):
    source: Source
    external_id: str
    title: str
    url: str | None = None
    price: Decimal | None = None
    original_price: Decimal | None = None
    currency: str = "USD"
    image_url: str | None = None
    orders_30d: int | None = None
    rating: float | None = None
    reviews_count: int | None = None
    sales_rank: int | None = None
    sales_rank_category: str | None = None
    seller_id: str | None = None
    seller_name: str | None = None
    seller_url: str | None = None
    seller_positive_rate: float | None = None
    shipping_cost: Decimal | None = None
    shipping_days: tuple[int, int] | None = None
    ships_from: str | None = None
    category: str | None = None
    tags: list[str] = Field(default_factory=list)

    @property
    def is_supplier(self) -> bool:
        """AliExpress en CJ zijn inkoopbronnen; Amazon is retail (concurrent/validatie)."""
        return self.source in ("aliexpress", "cj")

    @property
    def content_hash(self) -> str:
        return content_hash(
            {
                "p": self.price,
                "o": self.orders_30d,
                "r": self.rating,
                "n": self.reviews_count,
                "rank": self.sales_rank,
                "s": self.shipping_cost,
            }
        )


def parse_days(raw: object) -> tuple[int, int] | None:
    """'7-15', '7~15 dagen', 12 → (7, 15) / (12, 12)."""
    if raw is None or raw == "":
        return None
    nums = [int(n) for n in re.findall(r"\d+", str(raw))]
    if not nums:
        return None
    return (min(nums), max(nums))


def parse_percent(raw: object) -> float | None:
    if raw in (None, ""):
        return None
    m = re.search(r"[\d.]+", str(raw))
    return float(m.group(0)) if m else None
