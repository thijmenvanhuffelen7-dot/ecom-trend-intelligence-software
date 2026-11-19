"""Connector-framework. Elke databron is een losse, uitschakelbare module met een manifest."""

from __future__ import annotations

import abc
import importlib
from collections.abc import Iterator
from enum import StrEnum
from pathlib import Path
from typing import Any, ClassVar

import yaml
from pydantic import BaseModel, Field

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
    module: str


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

    def assert_permitted(self) -> None:
        """Productie draait alleen connectors die juridisch zijn goedgekeurd."""
        if self.settings.is_production and self.manifest.legal_review != LegalReview.approved:
            raise ConnectorNotPermitted(
                f"{self.manifest.id}: legal_review={self.manifest.legal_review}; zie {self.manifest.legal_basis_doc}"
            )

    @abc.abstractmethod
    def fetch(self, target: str) -> Iterator[bytes]:
        """Haalt ruwe payloads op voor een target (live)."""

    @abc.abstractmethod
    def fetch_mock(self, target: str) -> Iterator[bytes]:
        """Levert ruwe payloads uit fixtures (mock-modus)."""

    @abc.abstractmethod
    def parse(self, target: str, payload: bytes) -> list[Any]:
        """Zet een ruwe payload om in genormaliseerde records."""

    def run(self, target: str) -> list[Any]:
        self.assert_permitted()
        payloads = self.fetch_mock(target) if self.settings.data_mode == "mock" else self.fetch(target)
        records: list[Any] = []
        for payload in payloads:
            records.extend(self.parse(target, payload))
        return records


def load_manifests() -> dict[str, Manifest]:
    manifests: dict[str, Manifest] = {}
    for path in sorted(CONNECTORS_DIR.glob("*/manifest.yaml")):
        manifest = Manifest.model_validate(yaml.safe_load(path.read_text()))
        if manifest.id in manifests:
            raise ValueError(f"Dubbele connector-id: {manifest.id}")
        manifests[manifest.id] = manifest
    return manifests


def get_connector(connector_id: str, settings: Settings) -> Connector:
    manifest = load_manifests()[connector_id]
    module_name, _, class_name = manifest.module.partition(":")
    cls: type[Connector] = getattr(importlib.import_module(module_name), class_name)
    cls.manifest = manifest
    return cls(settings)
