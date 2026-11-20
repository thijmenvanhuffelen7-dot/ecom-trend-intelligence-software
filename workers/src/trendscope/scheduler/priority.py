"""Hoe vaak en met welke voorrang een winkel gecrawld wordt. Puur, zodat het makkelijk te tunen en testen is."""

from __future__ import annotations

import math
from dataclasses import dataclass

HOUR = 3600
DAY = 24 * HOUR


@dataclass(frozen=True)
class Schedule:
    priority: int  # 0 = hoogst, 100 = laagst
    interval_secs: int


def compute_schedule(
    *,
    watchers: int = 0,
    monthly_visits: int | None = None,
    visits_growth: float | None = None,
    changes_7d: int = 0,
    failures: int = 0,
    age_days: int | None = None,
) -> Schedule:
    """Hot (gevolgd, veel wijzigingen of nieuw) → elke 6 uur; slapend → elke 3 dagen; fouten → exponentiële backoff."""
    hot = watchers > 0 or changes_7d >= 5 or (age_days is not None and age_days <= 30)
    sleepy = changes_7d == 0 and (monthly_visits or 0) < 10_000 and watchers == 0
    interval = 6 * HOUR if hot else 3 * DAY if sleepy else DAY

    priority = 50
    if watchers:
        priority -= 20 + min(10, watchers)
    if visits_growth is not None and visits_growth >= 25:
        priority -= 10
    if monthly_visits:
        priority -= min(10, int(math.log10(max(monthly_visits, 1))) * 2 - 6) if monthly_visits >= 1000 else 0
    if age_days is not None and age_days <= 30:
        priority -= 10
    if changes_7d >= 5:
        priority -= 5

    if failures:
        # 2^n backoff, maximaal een week; en zakken in de wachtrij
        interval = min(7 * DAY, interval * 2 ** min(failures, 6))
        priority += 10 * failures
    return Schedule(priority=max(0, min(100, priority)), interval_secs=interval)
