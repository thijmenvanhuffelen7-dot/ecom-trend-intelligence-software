"""Forecasts, seizoenen en trendfases voor dagreeksen. Pure functies (numpy), zonder I/O.

Model: Holt-Winters (additief) met lineaire trend en weekseizoen (m = 7). Parameters kiezen we met een kleine
grid search op de één-stap-fout. Gedempte trend (phi < 1), zodat een explosieve stijging niet eindeloos wordt
doorgetrokken. Onzekerheid: residu-standaardafwijking, groeiend met √h. Waarom geen Prophet of gradient boosting:
zie ADR 0005 — voor korte, ruisige reeksen met weinig features presteert dit model even goed en blijft het uitlegbaar.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import product

import numpy as np

SEASON = 7
GRID_ALPHA = (0.2, 0.4, 0.6)
GRID_BETA = (0.02, 0.08, 0.2)
GRID_GAMMA = (0.05, 0.2)
PHI = 0.95


@dataclass(frozen=True)
class Forecast:
    method: str
    points: list[dict[str, float | str]]  # {d, v, lo, hi}
    mape: float | None  # fout (%) van hetzelfde model op de laatste 14 dagen, niet in de fit gezien
    trend_30d: float  # verwachte verandering t.o.v. de laatste 7 dagen, in procent


def _holt_winters(
    y: np.ndarray, alpha: float, beta: float, gamma: float, horizon: int
) -> tuple[np.ndarray, np.ndarray]:
    """Geeft (één-stap-voorspellingen in-sample, voorspelling voor `horizon` dagen)."""
    m = SEASON
    level = float(y[:m].mean())
    trend = float((y[m : 2 * m].mean() - y[:m].mean()) / m) if len(y) >= 2 * m else 0.0
    season = list(y[:m] - level)
    fitted = np.empty(len(y))
    for t, value in enumerate(y):
        s = season[t % m]
        fitted[t] = level + PHI * trend + s
        prev_level = level
        level = alpha * (value - s) + (1 - alpha) * (prev_level + PHI * trend)
        trend = beta * (level - prev_level) + (1 - beta) * PHI * trend
        season[t % m] = gamma * (value - level) + (1 - gamma) * s
    out = np.empty(horizon)
    damp = 0.0
    for h in range(1, horizon + 1):
        damp += PHI**h
        out[h - 1] = level + damp * trend + season[(len(y) + h - 1) % m]
    return fitted, out


def _fit(y: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray, tuple[float, float, float]]:
    best: tuple[float, np.ndarray, np.ndarray, tuple[float, float, float]] | None = None
    for a, b, g in product(GRID_ALPHA, GRID_BETA, GRID_GAMMA):
        fitted, fc = _holt_winters(y, a, b, g, horizon)
        err = float(np.mean((y[SEASON:] - fitted[SEASON:]) ** 2))
        if best is None or err < best[0]:
            best = (err, fitted, fc, (a, b, g))
    assert best is not None
    return best[1], best[2], best[3]


def forecast(values: Sequence[float], last_day: date, horizon: int = 90) -> Forecast | None:
    y = np.asarray(values, dtype=float)
    if len(y) < 4 * SEASON:
        return None
    # Eerlijke fout: fit zonder de laatste 14 dagen, vergelijk met wat er echt gebeurde
    holdout = 14
    _, fc_hold, _ = _fit(y[:-holdout], holdout)
    actual = y[-holdout:]
    denom = np.maximum(np.abs(actual), 1.0)
    mape = float(np.mean(np.abs(fc_hold - actual) / denom) * 100)

    fitted, fc, _ = _fit(y, horizon)
    resid = float(np.std(y[SEASON:] - fitted[SEASON:]))
    floor = 0.0 if float(y.min()) >= 0 else -math.inf
    points: list[dict[str, float | str]] = []
    for h in range(1, horizon + 1):
        v = max(floor, float(fc[h - 1]))
        band = 1.64 * resid * math.sqrt(h)  # ~90%-interval
        points.append(
            {
                "d": (last_day + timedelta(days=h)).isoformat(),
                "v": round(v, 2),
                "lo": round(max(floor, v - band), 2),
                "hi": round(v + band, 2),
            }
        )
    recent = float(y[-7:].mean()) or 1.0
    ahead = float(np.mean(fc[23:30]))
    return Forecast("holt_winters_damped_weekly", points, round(mape, 1), round((ahead / recent - 1) * 100, 1))


def seasonality(dates: Sequence[date], values: Sequence[float]) -> tuple[int | None, float]:
    """(piekmaand, sterkte 0–1). Een seizoen herhaalt zich: we vergelijken het maandprofiel van het laatste jaar met dat
    van het jaar ervoor (elk gedeeld door zijn eigen jaargemiddelde). Een stijger of een eenmalige hype heeft in het
    eerste jaar geen profiel en scoort daardoor laag. Vereist ~2 jaar data."""
    if len(values) < 700:
        return None, 0.0
    end = dates[-1]

    def profile(lo: date, hi: date) -> list[float] | None:
        months: dict[int, list[float]] = {}
        for d, v in zip(dates, values, strict=True):
            if lo < d <= hi:
                months.setdefault(d.month, []).append(float(v))
        if len(months) < 12:
            return None
        means = [sum(months[m]) / len(months[m]) for m in range(1, 13)]
        avg = sum(means) / 12
        return [m / avg for m in means] if avg > 0 else None

    last = profile(end - timedelta(days=365), end)
    prev = profile(end - timedelta(days=730), end - timedelta(days=365))
    if not last or not prev:
        return None, 0.0
    amp_last, amp_prev = max(last) - min(last), max(prev) - min(prev)
    if min(amp_last, amp_prev) < 0.2:
        return None, 0.0
    corr = float(np.corrcoef(last, prev)[0, 1])
    strength = max(0.0, corr) * min(1.0, (amp_last + amp_prev) / 2)
    combined = [a + b for a, b in zip(last, prev, strict=True)]
    peak = combined.index(max(combined)) + 1
    return (peak if corr >= 0.7 else None), round(strength, 2)


def _log_growth(y: Sequence[float], w: int, k: float = 3.0) -> float:
    if len(y) < 2 * w:
        return 0.0
    recent, prev = y[-w:], y[-2 * w : -w]
    return math.log((sum(recent) / w + k) / (sum(prev) / w + k))


def keyword_trend(values: Sequence[float]) -> tuple[float, float, str]:
    """(groei 7d %, groei 30d %, fase) voor een reeks van ~365 dagen.

    Fase op basis van groei én hoe nieuw de interesse is (laatste 30 dagen t.o.v. het eerste halfjaar):
    opkomend = sterke groei vanuit (bijna) niets, stijgend = duidelijke groei, dalend = duidelijke krimp,
    piek = stabiel rond het hoogste niveau, verzadigd = stabiel daaronder.
    """
    g7, g30 = _log_growth(values, 7), _log_growth(values, 30)
    top = max(values) if values else 0.0
    last30 = sum(values[-30:]) / max(1, len(values[-30:]))
    first = values[: len(values) // 2] or [0.0]
    novelty = (last30 + 1) / (sum(first) / len(first) + 1)
    level = last30 / top if top else 0.0
    if g30 < -0.1:
        phase = "declining"
    elif g30 > 0.25 and novelty > 3:
        phase = "emerging"
    elif g30 > 0.08:
        phase = "rising"
    elif level >= 0.8:
        phase = "peak"
    else:
        phase = "saturated"
    return round((math.exp(g7) - 1) * 100, 1), round((math.exp(g30) - 1) * 100, 1), phase
