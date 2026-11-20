"""Shopify storefront-connector: leest de publieke `/products.json` van een winkel."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

import httpx
from pydantic import BaseModel

from trendscope.connectors.base import Connector
from trendscope.core.http import PoliteHttpClient, RobotsDisallowed
from trendscope.pipeline.hashing import content_hash

PAGE_LIMIT = 250
MAX_PAGES = 40  # 10.000 producten; grotere catalogi verdelen we over meerdere runs
MAX_SITEMAP_PRODUCTS = 60  # terugvalpad: per run hooguit zoveel losse /products/<handle>.json
# Collecties die winkels zelf als bestsellers markeren. NB: `?sort_by=best-selling` staat in Shopify's
# standaard robots.txt op Disallow, dus die gebruiken we bewust níet.
BESTSELLER_HANDLE = re.compile(r"best[-_ ]?sell|bestsell|top[-_ ]?sell|most[-_ ]?popular|^popular|trending", re.I)


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
    raws = data.get("products") if "products" in data else [data["product"]] if "product" in data else []
    return [_parse_product(domain, raw) for raw in raws]


def _parse_product(domain: str, raw: dict[str, Any]) -> ShopifyProduct:
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
    return ShopifyProduct(
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


def parse_sitemap_locs(xml: str) -> list[str]:
    """<loc>-waarden uit een sitemap(-index). Regex i.p.v. XML-parser: geen entity-expansie mogelijk."""
    return [m.replace("&amp;", "&").strip() for m in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml)]


@dataclass
class CatalogFetch:
    products: list[ShopifyProduct]
    source: str  # products_json | sitemap
    complete: bool  # False als we de catalogus niet volledig konden ophalen (dan geen 'verwijderd'-events)
    requests: int = 0


@dataclass
class BestsellerFetch:
    ranks: dict[str, int] = field(default_factory=dict)  # handle → positie
    source: str | None = None


def fetch_catalog(client: PoliteHttpClient, domain: str) -> CatalogFetch:
    products: list[ShopifyProduct] = []
    requests = 0
    try:
        for page in range(1, MAX_PAGES + 1):
            result = client.get(f"https://{domain}/products.json?limit={PAGE_LIMIT}&page={page}")
            requests += 1
            batch = parse_products_json(domain, result.content)
            products.extend(batch)
            if len(batch) < PAGE_LIMIT:
                return CatalogFetch(products, "products_json", complete=True, requests=requests)
        return CatalogFetch(products, "products_json", complete=False, requests=requests)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code not in (401, 403, 404):
            raise
    # Terugval: sitemap → losse product-JSON's (sommige winkels schakelen /products.json uit)
    index = client.get(f"https://{domain}/sitemap.xml")
    requests += 1
    product_maps = [u for u in parse_sitemap_locs(index.text) if "sitemap_products" in u]
    handles: list[str] = []
    for url in product_maps:
        requests += 1
        handles += [u.rsplit("/products/", 1)[1] for u in parse_sitemap_locs(client.get(url).text) if "/products/" in u]
    for handle in handles[:MAX_SITEMAP_PRODUCTS]:
        try:
            products.extend(parse_products_json(domain, client.get(f"https://{domain}/products/{handle}.json").content))
            requests += 1
        except (httpx.HTTPStatusError, RobotsDisallowed):
            continue
    return CatalogFetch(products, "sitemap", complete=len(handles) <= MAX_SITEMAP_PRODUCTS, requests=requests)


def fetch_bestsellers(client: PoliteHttpClient, domain: str) -> BestsellerFetch:
    try:
        cols = json.loads(client.get(f"https://{domain}/collections.json").content).get("collections", [])
    except (httpx.HTTPStatusError, RobotsDisallowed, json.JSONDecodeError):
        return BestsellerFetch()
    match = next(
        (
            c
            for c in cols
            if BESTSELLER_HANDLE.search(c.get("handle", "")) or BESTSELLER_HANDLE.search(c.get("title", ""))
        ),
        None,
    )
    if not match:
        return BestsellerFetch()
    try:
        result = client.get(f"https://{domain}/collections/{match['handle']}/products.json?limit=50")
    except (httpx.HTTPStatusError, RobotsDisallowed):
        return BestsellerFetch()
    ranked = parse_products_json(domain, result.content)
    return BestsellerFetch({p.handle: i for i, p in enumerate(ranked, start=1)}, f"collection:{match['handle']}")


class ShopifyStorefrontConnector(Connector):
    """Geeft de ruwe /products.json-pagina's; de volledige winkelcrawl staat in trendscope.pipeline.store_crawl."""

    def fetch(self, target: str, client: PoliteHttpClient) -> Iterator[bytes]:
        for page in range(1, MAX_PAGES + 1):
            result = client.get(f"https://{target}/products.json?limit={PAGE_LIMIT}&page={page}")
            yield result.content
            if len(json.loads(result.content).get("products", [])) < PAGE_LIMIT:
                return

    def parse(self, target: str, payload: bytes) -> list[ShopifyProduct]:
        return parse_products_json(target, payload)
