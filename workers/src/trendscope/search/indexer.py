"""Winkels en productclusters naar Meilisearch (typo-tolerant zoeken, < 50 ms)."""

from __future__ import annotations

from typing import Any

import httpx
import psycopg
from psycopg.rows import dict_row

from trendscope.core.settings import get_settings

INDEXES: dict[str, dict[str, Any]] = {
    "stores": {
        "searchableAttributes": ["name", "domain", "niche", "theme"],
        "filterableAttributes": ["country", "platform", "niche_slug"],
        "sortableAttributes": ["monthly_visits", "live_ads"],
        "rankingRules": ["words", "typo", "proximity", "attribute", "exactness", "monthly_visits:desc"],
    },
    "products": {
        "searchableAttributes": ["title", "keywords", "niche", "category"],
        "filterableAttributes": ["phase", "niche_slug"],
        "sortableAttributes": ["opportunity"],
        "rankingRules": ["words", "typo", "proximity", "attribute", "exactness", "opportunity:desc"],
    },
}


def _client() -> httpx.Client:
    s = get_settings()
    return httpx.Client(
        base_url=s.meilisearch_url, headers={"Authorization": f"Bearer {s.meilisearch_master_key}"}, timeout=30
    )


def reindex_all() -> dict[str, int]:
    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        stores = conn.execute(
            """SELECT s.id, s.name, s.domain, s.country, s.platform::text AS platform, s.theme, s.monthly_visits,
                      s.live_ads, s.screenshot_url, n.slug AS niche_slug, n.name_en AS niche
               FROM stores s LEFT JOIN niches n ON n.id = s.niche_id"""
        ).fetchall()
        products = conn.execute(
            """SELECT c.id, c.canonical_title AS title, c.keywords, c.category, c.image_url, n.slug AS niche_slug,
                      n.name_en AS niche, s.opportunity, s.phase::text AS phase
               FROM product_clusters c LEFT JOIN niches n ON n.id = c.niche_id
               LEFT JOIN scores s ON s.entity_type = 'product_cluster' AND s.entity_id = c.id"""
        ).fetchall()
    out: dict[str, int] = {}
    with _client() as meili:
        for uid, docs in (("stores", stores), ("products", products)):
            meili.post("/indexes", json={"uid": uid, "primaryKey": "id"})  # 202 of 'bestaat al': beide prima
            meili.patch(f"/indexes/{uid}/settings", json=INDEXES[uid]).raise_for_status()
            for d in docs:
                d["id"] = int(d["id"])
                if d.get("opportunity") is not None:
                    d["opportunity"] = float(d["opportunity"])
            meili.put(f"/indexes/{uid}/documents", json=docs).raise_for_status()
            out[uid] = len(docs)
    return out
