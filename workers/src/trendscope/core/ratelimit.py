from __future__ import annotations

import threading
import time
from collections.abc import Callable


class TokenBucket:
    """Eenvoudige thread-safe token bucket. `rate` tokens per seconde, maximaal `capacity`."""

    def __init__(
        self,
        rate: float,
        capacity: float | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if rate <= 0:
            raise ValueError("rate moet > 0 zijn")
        self.rate = rate
        self.capacity = capacity if capacity is not None else max(1.0, rate)
        self._tokens = self.capacity
        self._clock = clock
        self._sleep = sleep
        self._updated = clock()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = self._clock()
        self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
        self._updated = now

    def acquire(self) -> float:
        """Blokkeert tot er een token is; geeft de gewachte tijd terug."""
        waited = 0.0
        while True:
            with self._lock:
                self._refill()
                if self._tokens >= 1:
                    self._tokens -= 1
                    return waited
                wait = (1 - self._tokens) / self.rate
            self._sleep(wait)
            waited += wait


class DomainRateLimiter:
    """Eén token bucket per domein, plus een globale limiet."""

    def __init__(self, per_domain_rps: float, global_rps: float | None = None) -> None:
        self.per_domain_rps = per_domain_rps
        self._buckets: dict[str, TokenBucket] = {}
        self._global = TokenBucket(global_rps) if global_rps else None
        self._lock = threading.Lock()

    def acquire(self, domain: str) -> None:
        with self._lock:
            bucket = self._buckets.get(domain)
            if bucket is None:
                bucket = self._buckets[domain] = TokenBucket(self.per_domain_rps)
        if self._global:
            self._global.acquire()
        bucket.acquire()
