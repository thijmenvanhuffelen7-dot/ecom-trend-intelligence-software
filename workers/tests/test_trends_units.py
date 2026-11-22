"""Trends en scoring: parsers, forecast, seizoen, fase, backtest-metrieken. Geen netwerk of database."""

import json
import math
from datetime import date, timedelta

import pytest

from trendscope.scoring.backtest import auc, evaluate, outcome, spearman
from trendscope.scoring.engine import EntityInput, Signal
from trendscope.scoring.live import demand_index
from trendscope.trends import dataforseo, reddit
from trendscope.trends.forecast import forecast, keyword_trend, seasonality


def test_dataforseo_parse_and_errors():
    payload = {
        "status_code": 20000,
        "tasks": [
            {
                "status_code": 20000,
                "result": [
                    {
                        "items": [
                            {
                                "type": "google_trends_graph",
                                "data": [
                                    {"date_from": "2026-11-01", "values": [40]},
                                    {"date_from": "2026-11-02", "values": [None]},
                                    {"date_from": "2026-11-03", "missing_data": True, "values": [0]},
                                    {"date_from": "2026-11-04", "values": [100]},
                                ],
                            },
                            {"type": "google_trends_map", "data": [{"date_from": "2026-11-01", "values": [1]}]},
                        ]
                    }
                ],
            }
        ],
    }
    assert dataforseo.parse_explore(json.dumps(payload).encode()) == [(date(2026, 11, 1), 40), (date(2026, 11, 4), 100)]
    with pytest.raises(dataforseo.DataForSeoError, match="40100"):
        dataforseo.parse_explore(json.dumps({"status_code": 40100, "status_message": "not authorized"}).encode())
    assert dataforseo.auth_header("a", "b") == {"Authorization": "Basic YTpi"}


def test_reddit_parse_skips_nsfw_and_keeps_no_usernames():
    payload = {
        "data": {
            "after": "t3_x",
            "children": [
                {
                    "kind": "t3",
                    "data": {
                        "id": "a1",
                        "subreddit": "Coffee",
                        "title": "Mushroom coffee?",
                        "permalink": "/r/Coffee/a1/",
                        "score": 12,
                        "num_comments": 3,
                        "created_utc": 1_763_000_000,
                        "author": "someone",
                    },
                },
                {"kind": "t3", "data": {"id": "a2", "title": "nsfw", "over_18": True, "created_utc": 1}},
                {"kind": "t1", "data": {"id": "c1"}},
            ],
        }
    }
    posts, after = reddit.parse_listing(json.dumps(payload).encode())
    assert after == "t3_x" and [p.post_id for p in posts] == ["a1"]
    assert posts[0].url == "https://www.reddit.com/r/Coffee/a1/"
    assert not hasattr(posts[0], "author"), "gebruikersnamen slaan we niet op"


def _series(n: int, f) -> list[float]:
    return [f(i) for i in range(n)]


def test_forecast_follows_trend_with_honest_interval():
    y = _series(120, lambda i: 50 + 0.5 * i + 5 * math.sin(2 * math.pi * i / 7))
    fc = forecast(y, date(2026, 11, 1))
    assert fc is not None and len(fc.points) == 90
    first, last = fc.points[0], fc.points[29]
    assert first["d"] == "2026-11-02"
    assert float(last["v"]) > y[-1], "stijgende reeks → stijgende verwachting"
    assert float(last["hi"]) - float(last["lo"]) > float(first["hi"]) - float(first["lo"]), "onzekerheid groeit"
    assert fc.mape is not None and fc.mape < 10
    assert fc.trend_30d > 0
    assert forecast([1.0] * 10, date(2026, 11, 1)) is None, "te korte reeks"


def test_forecast_never_negative_for_counts():
    y = _series(60, lambda i: max(0.0, 30 - i))
    fc = forecast(y, date(2026, 11, 1))
    assert fc is not None and all(float(p["lo"]) >= 0 and float(p["v"]) >= 0 for p in fc.points)


def _dates(n: int, end: date) -> list[date]:
    return [end - timedelta(days=n - 1 - i) for i in range(n)]


def test_seasonality_needs_repetition_not_just_growth():
    end = date(2026, 11, 20)
    days = _dates(730, end)
    seasonal = [50 * (1 + 0.4 * math.cos(2 * math.pi * (d.timetuple().tm_yday - 196) / 365.25)) for d in days]
    peak, strength = seasonality(days, seasonal)
    assert peak == 7 and strength > 0.5
    hype = [5.0 if i < 600 else 5 + (i - 600) * 0.8 for i in range(730)]
    assert seasonality(days, hype)[0] is None, "een stijger is geen seizoen"
    assert seasonality(days[:300], seasonal[:300]) == (None, 0.0), "één jaar is niet genoeg"


@pytest.mark.parametrize(
    ("shape", "phase"),
    [
        (lambda i: 2.0 if i < 680 else 2 + (i - 680) ** 1.5, "emerging"),
        (lambda i: 10 * math.exp(i / 150), "rising"),
        (lambda i: 100 - max(0, i - 650) * 0.9, "declining"),
        (lambda i: 50.0, "peak"),
    ],
)
def test_keyword_phase(shape, phase):
    assert keyword_trend(_series(730, shape))[2] == phase


def test_rank_metrics():
    assert spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)
    assert spearman([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1.0)
    assert auc([0.9, 0.8, 0.1, 0.2], [True, True, False, False]) == 1.0
    assert auc([0.1, 0.2], [False, False]) is None


def test_backtest_has_no_lookahead_and_finds_signal():
    """Producten die al vóór de cutoff opkomen, blijven daarna groeien: de backtest moet dat meten."""
    inputs = []
    for k in range(30):
        rising = k < 8

        def f(i: int, rising: bool = rising, k: int = k) -> float:
            return 10 + (i**1.6) * 0.05 if rising else 10 + (k % 3)

        series = {s: _series(90, f) for s in (Signal.search, Signal.marketplace, Signal.reddit, Signal.store)}
        inputs.append(EntityInput(entity_id=k, series=series, store_count=5, category="c"))
    metrics, top = evaluate(inputs, 21, {})
    assert metrics["n"] == 30
    assert metrics["spearman_validation"] > 0.5
    assert metrics["precision_at_10"] >= 0.7
    assert all(t["cluster_id"] < 8 for t in top[:8])
    # uitkomst kijkt alleen naar de toekomst t.o.v. de cutoff
    assert outcome({Signal.search: [1.0] * 70 + [100.0] * 20}, 70) > 2


def test_demand_index_scales_sources():
    idx = demand_index({Signal.search: [50.0] * 30, Signal.marketplace: [5000.0] * 30})
    assert idx == [100.0] * 30
