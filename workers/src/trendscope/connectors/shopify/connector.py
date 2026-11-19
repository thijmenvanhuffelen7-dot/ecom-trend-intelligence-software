"""Shopify storefront-connector: leest de publieke `/products.json` van een winkel."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from trendscope.connectors.base import Connector
from trendscope.core.http import PoliteHttpClient
from trendscope.pipeline.hashing import content_hash

PAGE_LIMIT = 250
MAX_PAGES = 40  # 10.000 producten; grotere catalogi verdelen we over meerdere runs


class ShopifyVariant(BaseModel):
    external_id: str
    title: str
    price: Decimal
    compare_at_price: Decimal | None
    available: bool
    sku: str | None


class ShopifyProduct(BaseModel):
    store_domain: str
    external_id: str
    handle: str
    url: str
    title: str
    vendor: str | None
    product_type: str | None
    tags: list[str]
    images: list[str]
    price: Decimal | None
    compare_at_price: Decimal | None
    available: bool
    variants: list[ShopifyVariant]
    published_at: datetime | None
    updated_at: datetime | None

    @property
    def content_hash(self) -> str:
        """Hash over de velden die een snapshot rechtvaardigen (prijs, voorraad, varianten)."""
        return content_hash(
            {
                "price": self.price,
                "compare_at_price": self.compare_at_price,
                "available": self.available,
                "variants": [(v.external_id, v.price, v.available) for v in self.variants],
            }
        )


def _tags(raw: object) -> list[str]:
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    if isinstance(raw, str):
        return [t.strip() for t in raw.split(",") if t.strip()]
    return []


def _decimal(raw: object) -> Decimal | None:
    if raw in (None, ""):
        return None
    return Decimal(str(raw))


def _dt(raw: object) -> datetime | None:
    return datetime.fromisoformat(str(raw)) if raw else None


def parse_products_json(domain: str, payload: bytes) -> list[ShopifyProduct]:
    data = json.loads(payload)
    products: list[ShopifyProduct] = []
    for raw in data.get("products", []):
        variants = [
            ShopifyVariant(
                external_id=str(v["id"]),
                title=v.get("title") or "",
                price=Decimal(str(v.get("price") or "0")),
                compare_at_price=_decimal(v.get("compare_at_price")),
                available=bool(v.get("available", True)),
                sku=v.get("sku") or None,
            )
            for v in raw.get("variants", [])
        ]
        prices = [v.price for v in variants]
        cheapest = min(variants, key=lambda v: v.price) if variants else None
        products.append(
            ShopifyProduct(
                store_domain=domain,
                external_id=str(raw["id"]),
                handle=raw["handle"],
                url=f"https://{domain}/products/{raw['handle']}",
                title=raw["title"].strip(),
                vendor=raw.get("vendor") or None,
                product_type=raw.get("product_type") or None,
                tags=_tags(raw.get("tags")),
                images=[img["src"] for img in raw.get("images", []) if img.get("src")],
                price=min(prices) if prices else None,
                compare_at_price=cheapest.compare_at_price if cheapest else None,
                available=any(v.available for v in variants),
                variants=variants,
                published_at=_dt(raw.get("published_at")),
                updated_at=_dt(raw.get("updated_at")),
            )
        )
    return products


class ShopifyStorefrontConnector(Connector):
    def fetch(self, target: str) -> Iterator[bytes]:
        limits = self.manifest.default_rate_limit
        with PoliteHttpClient(
            self.settings.crawler_user_agent,
            per_domain_rps=limits.per_domain_rps,
            global_rps=limits.global_rps,
        ) as client:
            for page in range(1, MAX_PAGES + 1):
                result = client.get(f"https://{target}/products.json?limit={PAGE_LIMIT}&page={page}")
                yield result.content
                if len(json.loads(result.content).get("products", [])) < PAGE_LIMIT:
                    return

    def fetch_mock(self, target: str) -> Iterator[bytes]:
        yield (self.fixtures_dir / "products_page1.json").read_bytes()

    def parse(self, target: str, payload: bytes) -> list[ShopifyProduct]:
        return parse_products_json(target, payload)
