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

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
