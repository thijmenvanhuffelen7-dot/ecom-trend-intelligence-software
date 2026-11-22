"""Zoekinteresse via DataForSEO (Google Trends Explore, live).

De officiële Google Trends API is in alpha met beperkte toegang; tot die er is, gebruiken we een datapartner.
Endpoint: POST https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live (HTTP Basic-auth).
Eén keyword per aanvraag: Google normaliseert binnen een aanvraag naar max = 100, dus losse aanvragen houden
elke reeks op zijn eigen schaal. We overschrijven steeds het hele venster (geen naad tussen aanvragen).
"""

from __future__ import annotations

import base64
import json
from datetime import date
from typing import Any

from trendscope.core.http import PoliteHttpClient

ENDPOINT = "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live"
LOCATIONS = {"NL": "Netherlands", "DE": "Germany", "GB": "United Kingdom", "US": "United States"}


class DataForSeoError(Exception):
    pass


def auth_header(login: str, password: str) -> dict[str, str]:
    token = base64.b64encode(f"{login}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def parse_explore(payload: bytes) -> list[tuple[date, int]]:
    data = json.loads(payload)
    if data.get("status_code") != 20000:
        raise DataForSeoError(f"{data.get('status_code')}: {data.get('status_message')}")
    task = (data.get("tasks") or [{}])[0]
    if task.get("status_code") != 20000:
        raise DataForSeoError(f"{task.get('status_code')}: {task.get('status_message')}")
    points: list[tuple[date, int]] = []
    for result in task.get("result") or []:
        for item in result.get("items") or []:
            if item.get("type") != "google_trends_graph":
                continue
            for row in item.get("data") or []:
                if row.get("missing_data"):
                    continue
                values: list[Any] = row.get("values") or []
                if values and values[0] is not None:
                    points.append((date.fromisoformat(row["date_from"]), int(values[0])))
    return points


def explore(
    client: PoliteHttpClient, login: str, password: str, term: str, country: str, start: date, end: date
) -> list[tuple[date, int]]:
    body = [
        {
            "keywords": [term],
            "location_name": LOCATIONS[country],
            "date_from": start.isoformat(),
            "date_to": end.isoformat(),
            "type": "web",
            "item_types": ["google_trends_graph"],
        }
    ]
    res = client.post(ENDPOINT, json=body, headers=auth_header(login, password))
    return parse_explore(res.content)
