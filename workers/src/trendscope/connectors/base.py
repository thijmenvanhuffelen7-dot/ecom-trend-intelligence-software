"""Connector-framework. Elke databron is een losse, uitschakelbare module met een manifest."""

from __future__ import annotations

import abc
import importlib
from collections.abc import Iterator
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Any, ClassVar

import yaml
from pydantic import BaseModel, Field

from trendscope.core.http import PoliteHttpClient
from trendscope.core.settings import Settings

CONNECTORS_DIR = Path(__file__).parent


class ConnectorKind(StrEnum):
    official_api = "official_api"
    partner_api = "partner_api"
    scrape_public = "scrape_public"
    user_provided = "user_provided"


class LegalReview(StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class PersonalData(StrEnum):
    none = "none"
    public_business = "public_business"


class RateLimit(BaseModel):
    per_domain_rps: float = Field(gt=0, le=10)
    global_rps: float = Field(gt=0)


class Manifest(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]+$")
    display_name: str
    kind: ConnectorKind
    legal_basis_doc: str
    legal_review: LegalReview = LegalReview.pending
    respects_robots_txt: bool
    default_rate_limit: RateLimit
    requires_credentials: list[str] = []
    personal_data: PersonalData = PersonalData.none
    retention_days: int = Field(gt=0)
    freshness_sla_hours: int = 24
    module: str | None = None  # None: alleen configuratie (rate limits, juridische status), geen eigen klasse


class ConnectorNotPermitted(Exception):
    pass


class Connector(abc.ABC):
    """Basisklasse. Subklassen implementeren `fetch` (live) en `parse`; mock-modus leest fixtures."""

    manifest: ClassVar[Manifest]

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def fixtures_dir(self) -> Path:
        return CONNECTORS_DIR / self.manifest.id.split("_")[0] / "fixtures"

    def client(self) -> PoliteHttpClient:
        """Echte netwerktoegang, of in mock-modus het nep-internet (zelfde codepad, zelfde robots-regels)."""
        from trendscope.core.clients import http_client_for

        return http_client_for(self.manifest, self.settings)

    def assert_permitted(self) -> None:
        """Productie draait alleen connectors die juridisch zijn goedgekeurd."""
        if self.settings.is_production and self.manifest.legal_review != LegalReview.approved:
            raise ConnectorNotPermitted(
                f"{self.manifest.id}: legal_review={self.manifest.legal_review}; zie {self.manifest.legal_basis_doc}"
            )

    @abc.abstractmethod
    def fetch(self, target: str, client: PoliteHttpClient) -> Iterator[bytes]:
        """Haalt ruwe payloads op voor een target."""

    @abc.abstractmethod
    def parse(self, target: str, payload: bytes) -> list[Any]:
        """Zet een ruwe payload om in genormaliseerde records."""

    def run(self, target: str, client: PoliteHttpClient | None = None) -> list[Any]:
        self.assert_permitted()
        records: list[Any] = []
        with client or self.client() as c:
            for payload in self.fetch(target, c):
                records.extend(self.parse(target, payload))
        return records


@lru_cache(maxsize=1)
def _load_manifests() -> dict[str, Manifest]:
    manifests: dict[str, Manifest] = {}
    for path in sorted(CONNECTORS_DIR.glob("*/manifest.yaml")):
        manifest = Manifest.model_validate(yaml.safe_load(path.read_text()))
        if manifest.id in manifests:
            raise ValueError(f"Dubbele connector-id: {manifest.id}")
        manifests[manifest.id] = manifest
    return manifests


def load_manifests() -> dict[str, Manifest]:
    """Manifests zijn statische bestanden: één keer per proces inlezen (scheelt ~20 ms per crawl)."""
    return dict(_load_manifests())


def get_connector(connector_id: str, settings: Settings) -> Connector:
    manifest = load_manifests()[connector_id]
    if not manifest.module:
        raise ValueError(f"{connector_id} heeft geen connector-klasse")
    module_name, _, class_name = manifest.module.partition(":")
    cls: type[Connector] = getattr(importlib.import_module(module_name), class_name)
    cls.manifest = manifest
    return cls(settings)
