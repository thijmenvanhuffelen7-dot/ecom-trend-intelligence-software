"""Google Ads Transparency Center via de publieke BigQuery-dataset (EER + Turkije).

De dataset bevat geen tekst, landingspagina of beeld; wel formaat, regio's, vertoningsbandbreedtes en
de link naar de Transparency-pagina. We gebruiken haar vooral om adverteerders en hun volume te volgen.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from datetime import date
from typing import Any

from trendscope.ads.records import AdFormat, AdRecord

DATASET = "bigquery-public-data.google_ads_transparency_center.creative_stats"
FORMATS: dict[str, AdFormat] = {"TEXT": "text", "IMAGE": "image", "VIDEO": "video"}

# Gefilterd op adverteerder: BigQuery rekent per gescande byte, dus nooit zonder filter draaien
QUERY = f"""
SELECT advertiser_id, advertiser_disclosed_name, advertiser_location, creative_id, creative_page_url,
       ad_format_type, rs.region_code, rs.first_shown, rs.last_shown,
       rs.times_shown_lower_bound, rs.times_shown_upper_bound
FROM `{DATASET}`, UNNEST(region_stats) AS rs
WHERE advertiser_id IN UNNEST(@advertiser_ids) AND rs.last_shown >= @since
"""


def parse_rows(rows: Iterable[dict[str, Any]], today: date) -> Iterator[AdRecord]:
    """Eén rij per (creative, regio) → één record per creative met alle regio's samengevoegd."""
    by_creative: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_creative.setdefault(str(r["creative_id"]), []).append(r)
    for cid, regions in by_creative.items():
        first = min(_d(r["first_shown"]) for r in regions)
        last = max(_d(r["last_shown"]) for r in regions)
        low = sum(int(r["times_shown_lower_bound"] or 0) for r in regions if r.get("region_code") != "EEA")
        high = sum(int(r["times_shown_upper_bound"] or 0) for r in regions if r.get("region_code") != "EEA")
        head = regions[0]
        yield AdRecord(
            platform="google",
            external_id=cid,
            advertiser_external_id=str(head["advertiser_id"]),
            advertiser_name=head.get("advertiser_disclosed_name") or str(head["advertiser_id"]),
            format=FORMATS.get(str(head.get("ad_format_type", "")).upper(), "other"),
            countries=sorted(
                {r["region_code"] for r in regions if r.get("region_code") and len(r["region_code"]) == 2}
            ),
            publisher_platforms=["google"],
            start_date=first,
            end_date=None if (today - last).days <= 1 else last,
            is_active=(today - last).days <= 1,
            snapshot_url=head.get("creative_page_url"),
            impressions_low=low or None,
            impressions_high=high or None,
        )


def _d(raw: Any) -> date:
    return raw if isinstance(raw, date) else date.fromisoformat(str(raw)[:10])


def query_bigquery(advertiser_ids: list[str], since: date) -> list[dict[str, Any]]:  # pragma: no cover - live
    from google.cloud import bigquery

    client = bigquery.Client()
    job = client.query(
        QUERY,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ArrayQueryParameter("advertiser_ids", "STRING", advertiser_ids),
                bigquery.ScalarQueryParameter("since", "DATE", since),
            ],
            maximum_bytes_billed=50 * 1024**3,  # harde kostenlimiet per query
        ),
    )
    return [dict(row.items()) for row in job.result()]
