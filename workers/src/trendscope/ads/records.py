"""Eén genormaliseerd ad-record, ongeacht het platform."""

from __future__ import annotations

import re
from datetime import date
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from trendscope.pipeline.hashing import content_hash

Platform = Literal["meta", "tiktok", "google"]
AdFormat = Literal["image", "video", "carousel", "text", "other"]


class Media(BaseModel):
    type: Literal["image", "video"]
    url: str
    poster: str | None = None
    storage_key: str | None = None


class AdRecord(BaseModel):
    platform: Platform
    external_id: str
    advertiser_external_id: str
    advertiser_name: str
    format: AdFormat | None = None
    body: str | None = None
    headline: str | None = None
    link_caption: str | None = None
    link_description: str | None = None
    cta: str | None = None
    landing_url: str | None = None
    countries: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    publisher_platforms: list[str] = Field(default_factory=list)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool = True
    snapshot_url: str | None = None
    eu_reach: int | None = None
    impressions_low: int | None = None
    impressions_high: int | None = None
    media: list[Media] = Field(default_factory=list)
    target_ages: str | None = None
    target_gender: str | None = None

    @property
    def landing_domain(self) -> str | None:
        return landing_domain(self.landing_url) or landing_domain(self.link_caption)

    @property
    def creative_hash(self) -> str:
        """Ads met dezelfde tekst + titel zijn varianten van één creative (andere doelgroep/plaatsing)."""
        return content_hash({"b": normalize_text(self.body), "h": normalize_text(self.headline)})[:16]

    @property
    def content_hash(self) -> str:
        """Velden waarvan een wijziging een snapshot rechtvaardigt."""
        return content_hash(
            {
                "active": self.is_active,
                "end": self.end_date,
                "reach": self.eu_reach,
                "imp": (self.impressions_low, self.impressions_high),
                "countries": sorted(self.countries),
            }
        )


_DOMAIN = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")


def landing_domain(value: str | None) -> str | None:
    """'https://www.Lumora.nl/products/x?utm=1' of 'LUMORA.NL' → 'lumora.nl'."""
    if not value:
        return None
    v = value.strip().lower()
    host = urlsplit(v).netloc if "://" in v else v.split("/")[0]
    host = host.split(":")[0].removeprefix("www.").removeprefix("shop.").removeprefix("m.")
    return host if _DOMAIN.match(host) else None


def normalize_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (text or "").lower())).strip()
