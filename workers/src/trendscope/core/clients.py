"""Fabriek voor HTTP-clients per connector: echte netwerktoegang of het nep-internet (mock-modus)."""

from __future__ import annotations

import httpx

from trendscope.connectors.base import Manifest
from trendscope.core.http import PoliteHttpClient, RateLimiter
from trendscope.core.settings import Settings


def http_client_for(
    manifest: Manifest,
    settings: Settings,
    *,
    transport: httpx.BaseTransport | None = None,
    limiter: RateLimiter | None = None,
) -> PoliteHttpClient:
    limits = manifest.default_rate_limit
    if settings.data_mode == "mock" and transport is None:
        from trendscope.mockweb.transport import MockWebTransport

        transport = MockWebTransport()
    mock = settings.data_mode == "mock"
    return PoliteHttpClient(
        settings.crawler_user_agent,
        # Het nep-internet hoeft niet ontzien te worden; robots.txt respecteren we wél (ook dat testen we)
        per_domain_rps=1000 if mock else limits.per_domain_rps,
        global_rps=None if mock else limits.global_rps,
        respect_robots=manifest.respects_robots_txt,
        transport=transport,
        limiter=None if mock else limiter,
        max_retries=1 if mock else 4,
    )
