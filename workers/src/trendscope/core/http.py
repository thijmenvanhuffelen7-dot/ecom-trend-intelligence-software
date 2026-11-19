"""Beleefde HTTP-client: de enige weg waarlangs connectors het web op gaan.

Dwingt af: robots.txt, rate limits per domein, een identificeerbare User-Agent,
backoff bij 429/5xx (met respect voor Retry-After) en conditional requests.
Bewust níet aanwezig: CAPTCHA-solvers, login-omzeiling of fingerprint-spoofing.
"""

from __future__ import annotations

import time
import urllib.robotparser
from collections.abc import Callable
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

import httpx

from trendscope.core.ratelimit import DomainRateLimiter

RETRY_STATUSES = {429, 500, 502, 503, 504}


class RobotsDisallowed(Exception):
    """De URL is volgens robots.txt niet toegestaan voor onze User-Agent."""


@dataclass(frozen=True)
class FetchResult:
    url: str
    status: int
    content: bytes
    headers: httpx.Headers
    not_modified: bool = False

    def json(self) -> object:
        import json

        return json.loads(self.content)


class PoliteHttpClient:
    def __init__(
        self,
        user_agent: str,
        per_domain_rps: float = 0.5,
        global_rps: float | None = None,
        max_retries: int = 4,
        backoff_base: float = 1.0,
        timeout: float = 20.0,
        respect_robots: bool = True,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.user_agent = user_agent
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.respect_robots = respect_robots
        self._sleep = sleep
        self._limiter = DomainRateLimiter(per_domain_rps, global_rps)
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self._client = httpx.Client(
            headers={"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"},
            timeout=timeout,
            follow_redirects=True,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> PoliteHttpClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # -- robots.txt -------------------------------------------------------
    def _robots_for(self, base: str) -> urllib.robotparser.RobotFileParser:
        parser = self._robots.get(base)
        if parser is not None:
            return parser
        parser = urllib.robotparser.RobotFileParser()
        try:
            resp = self._client.get(f"{base}/robots.txt")
            if resp.status_code in (401, 403):
                parser.disallow_all = True  # type: ignore[attr-defined]
            elif resp.status_code >= 400:
                parser.allow_all = True  # type: ignore[attr-defined]
            else:
                parser.parse(resp.text.splitlines())
        except httpx.HTTPError:
            # Onbereikbare robots.txt: conservatief, niets crawlen tot de volgende poging.
            parser.disallow_all = True  # type: ignore[attr-defined]
            return parser
        self._robots[base] = parser
        return parser

    def is_allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        parts = urlsplit(url)
        return self._robots_for(f"{parts.scheme}://{parts.netloc}").can_fetch(self.user_agent, url)

    # -- fetch -----------------------------------------------------------
    def _retry_after(self, resp: httpx.Response, attempt: int) -> float:
        header = resp.headers.get("Retry-After")
        if header:
            if header.isdigit():
                return float(header)
            try:
                return max(0.0, parsedate_to_datetime(header).timestamp() - time.time())
            except (TypeError, ValueError):
                pass
        return float(self.backoff_base * (2**attempt))

    def get(self, url: str, etag: str | None = None, last_modified: str | None = None) -> FetchResult:
        if not self.is_allowed(url):
            raise RobotsDisallowed(url)
        headers: dict[str, str] = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        domain = urlsplit(url).netloc
        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            self._limiter.acquire(domain)
            try:
                resp = self._client.get(url, headers=headers)
            except httpx.TransportError as exc:
                last_exc = exc
                self._sleep(self.backoff_base * (2**attempt))
                continue
            if resp.status_code == 304:
                return FetchResult(url, 304, b"", resp.headers, not_modified=True)
            if resp.status_code in RETRY_STATUSES and attempt < self.max_retries:
                self._sleep(self._retry_after(resp, attempt))
                continue
            resp.raise_for_status()
            return FetchResult(str(resp.url), resp.status_code, resp.content, resp.headers)
        raise last_exc or RuntimeError(f"Ophalen mislukt na {self.max_retries} pogingen: {url}")
