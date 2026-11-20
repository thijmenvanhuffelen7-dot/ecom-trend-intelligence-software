from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Centrale configuratie; leest uit de omgeving en de root-`.env`."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_env: Literal["development", "test", "staging", "production"] = "development"
    data_mode: Literal["mock", "live"] = "mock"

    database_url: str = "postgresql://trendscope:trendscope@localhost:5432/trendscope"
    clickhouse_url: str = "http://trendscope:trendscope@localhost:8123/trendscope"
    redis_url: str = "redis://localhost:6379/0"

    crawler_user_agent: str = "TrendscopeBot/0.1 (+https://trendscope.example/bot)"
    crawler_default_rps_per_domain: float = 0.5

    # Scheduler
    scheduler_batch: int = 50  # max. targets per tick
    crawl_lease_minutes: int = 30  # zo lang is een geclaimd target vergrendeld
    crawl_max_failures: int = 5  # daarna: dead letter + wekelijkse herpoging

    # Discovery: zoektermen voor Certificate Transparency (crt.sh)
    discovery_keywords: list[str] = ["shop", "store", "beauty", "skin", "pets", "home", "fit", "baby", "wear"]

    # Zoeken
    meilisearch_url: str = "http://localhost:7700"
    meilisearch_master_key: str = "dev-master-key"

    # Mock-modus: map met de dag-0-staat en (optioneel) een vaste gesimuleerde dag
    mockweb_dir: str = ".mockweb"
    mock_web_day: int | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
