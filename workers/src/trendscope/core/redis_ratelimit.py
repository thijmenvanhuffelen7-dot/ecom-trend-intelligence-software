"""Rate limiter die over alle workers heen werkt: één 'volgende toegestane moment' per domein in Redis."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

# Atomair: gebruik Redis' eigen klok, zodat klokverschillen tussen workers niet uitmaken.
_SCRIPT = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local interval = tonumber(ARGV[1])
local nxt = tonumber(redis.call('GET', KEYS[1]) or '0')
if now >= nxt then
  redis.call('SET', KEYS[1], now + interval, 'PX', interval * 2 + 1000)
  return 0
end
return nxt - now
"""


class RedisDomainRateLimiter:
    def __init__(
        self,
        redis: Any,
        per_domain_rps: float,
        global_rps: float | None = None,
        sleep: Callable[[float], None] = time.sleep,
        prefix: str = "ratelimit",
    ) -> None:
        self._script = redis.register_script(_SCRIPT)
        self._interval_ms = max(1, int(1000 / per_domain_rps))
        self._global_ms = max(1, int(1000 / global_rps)) if global_rps else None
        self._sleep = sleep
        self._prefix = prefix

    def _wait(self, key: str, interval_ms: int) -> None:
        while True:
            wait_ms = int(self._script(keys=[key], args=[interval_ms]))
            if wait_ms <= 0:
                return
            self._sleep(wait_ms / 1000)

    def acquire(self, domain: str) -> None:
        if self._global_ms:
            self._wait(f"{self._prefix}:__global__", self._global_ms)
        self._wait(f"{self._prefix}:{domain}", self._interval_ms)
