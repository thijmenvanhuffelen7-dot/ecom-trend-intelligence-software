"""Marktplaats-targets: q:<zoekterm> per connector (aliexpress_affiliate, amazon_creators, cj_dropshipping)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg
from clickhouse_connect.driver.client import Client as ClickHouse

from trendscope.core.http import PoliteHttpClient
from trendscope.core.settings import Settings
from trendscope.marketplaces import aliexpress, amazon, cj
from trendscope.marketplaces.ingest import ingest_listings
from trendscope.marketplaces.records import Listing
from trendscope.pipeline.store_crawl import CrawlOutcome

MARKETPLACE_CONNECTORS = {"aliexpress_affiliate", "amazon_creators", "cj_dropshipping"}


class MissingCredentials(Exception):
    pass


def _cred(settings: Settings, value: str, name: str) -> str:
    if value:
        return value
    if settings.data_mode == "mock":
        return f"mock-{name.lower()}"
    raise MissingCredentials(f"{name} ontbreekt")


def fetch_listings(client: PoliteHttpClient, settings: Settings, connector: str, term: str) -> list[Listing]:
    if connector == "aliexpress_affiliate":
        return list(
            aliexpress.search(
                client,
                app_key=_cred(settings, settings.aliexpress_app_key, "ALIEXPRESS_APP_KEY"),
                app_secret=_cred(settings, settings.aliexpress_app_secret, "ALIEXPRESS_APP_SECRET"),
                keywords=term,
                ship_to=settings.marketplace_ship_to,
                max_pages=1,
                page_size=20,
            )
        )
    if connector == "amazon_creators":
        token = amazon.get_token(
            client,
            _cred(settings, settings.amazon_creators_client_id, "AMAZON_CREATORS_CLIENT_ID"),
            _cred(settings, settings.amazon_creators_client_secret, "AMAZON_CREATORS_CLIENT_SECRET"),
        )
        return list(
            amazon.search(
                client,
                token=token,
                partner_tag=_cred(settings, settings.amazon_partner_tag, "AMAZON_PARTNER_TAG"),
                keywords=term,
                marketplace=settings.amazon_marketplace,
            )
        )
    if connector == "cj_dropshipping":
        token = cj.get_token(client, _cred(settings, settings.cj_api_key, "CJ_API_KEY"))
        return list(cj.search(client, token=token, keywords=term, ship_to=settings.marketplace_ship_to, page_size=10))
    raise ValueError(f"Onbekende marktplaats-connector {connector}")


def run_marketplace_target(
    conn: psycopg.Connection[Any],
    ch: ClickHouse,
    client: PoliteHttpClient,
    settings: Settings,
    target: dict[str, Any],
    now: datetime,
) -> CrawlOutcome:
    term = target["target"].removeprefix("q:")
    listings = fetch_listings(client, settings, target["connector_id"], term)
    outcome = ingest_listings(
        conn,
        ch,
        client,
        listings,
        now=now,
        store_images=settings.data_mode == "mock" or settings.store_marketplace_images,
    )
    return CrawlOutcome("succeeded", items=len(listings), stats=outcome.stats())
