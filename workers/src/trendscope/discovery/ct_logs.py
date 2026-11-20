"""Kandidaat-domeinen uit Certificate Transparency-logs (via crt.sh's JSON-uitvoer)."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Any
from urllib.parse import quote

from trendscope.core.http import PoliteHttpClient

DOMAIN = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")
# Subdomeinen die op infrastructuur wijzen, niet op een winkel
INFRA_PREFIXES = (
    "www.",
    "mail.",
    "webmail.",
    "smtp.",
    "autodiscover.",
    "cpanel.",
    "m.",
    "shop.",
    "store.",
    "api.",
    "cdn.",
)
SKIP_SUFFIXES = (".myshopify.com", ".shopifypreview.com", ".wixsite.com", ".cloudfront.net", ".amazonaws.com")


def extract_domains(entries: Iterable[dict[str, Any]]) -> set[str]:
    """Normaliseert crt.sh-namen (meerdere per certificaat, wildcards, subdomeinen) tot winkeldomeinen."""
    out: set[str] = set()
    for entry in entries:
        for raw in str(entry.get("name_value", "")).splitlines() + [str(entry.get("common_name", ""))]:
            name = raw.strip().lower().rstrip(".")
            if not name or name.startswith("*.") or "@" in name:
                continue
            for prefix in INFRA_PREFIXES:
                if name.startswith(prefix) and name.count(".") >= 2:
                    name = name[len(prefix) :]
                    break
            if name.endswith(SKIP_SUFFIXES) or not DOMAIN.match(name):
                continue
            out.add(name)
    return out


def query_crtsh(client: PoliteHttpClient, keyword: str) -> list[dict[str, Any]]:
    url = f"https://crt.sh/?q={quote('%' + keyword + '%')}&output=json&exclude=expired&deduplicate=Y"
    data = json.loads(client.get(url).content or b"[]")
    return data if isinstance(data, list) else []
