"""Dag-0-staat van de demowinkels, weggeschreven door de seed en gelezen door het nep-internet."""

from __future__ import annotations

import json
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from trendscope.core.settings import get_settings


class StoreBaseline(BaseModel):
    domain: str
    name: str
    country: str
    currency: str
    language: str
    theme: str
    arch: str
    color: str
    niches: list[str]
    technologies: list[str]
    social: dict[str, str]
    products: list[dict[str, Any]]
    pages: list[dict[str, Any]] = []  # Meta-pagina's met hun ads op dag 0
    platform: str = "shopify"
    launch_day: int = 0  # dag (t.o.v. day0) waarop een nog-niet-ontdekte winkel live gaat


class Baseline(BaseModel):
    day0: date
    stores: list[StoreBaseline]


def baseline_path() -> Path:
    return Path(get_settings().mockweb_dir) / "baseline.json"


def write_baseline(stores: list[StoreBaseline], day0: date) -> Path:
    path = baseline_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(Baseline(day0=day0, stores=stores).model_dump_json())
    load_baseline.cache_clear()
    return path


@lru_cache(maxsize=1)
def load_baseline() -> Baseline:
    path = baseline_path()
    if not path.exists():
        raise FileNotFoundError(f"{path} ontbreekt — draai eerst `trendscope seed`")
    return Baseline.model_validate(json.loads(path.read_text()))
