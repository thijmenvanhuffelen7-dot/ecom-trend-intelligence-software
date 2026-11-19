import math

from trendscope.scoring.engine import EntityInput, Signal, log_growth, percentile_ranks, score_population


def flat(v: float, n: int = 60) -> list[float]:
    return [v] * n


def ramp(start: float, end: float, n: int = 60) -> list[float]:
    return [start + (end - start) * i / (n - 1) for i in range(n)]


def test_log_growth_flat_is_zero():
    assert log_growth(flat(10), 7, 3) == 0


def test_log_growth_positive_for_ramp():
    assert log_growth(ramp(1, 100), 7, 3) > 0.1


def test_log_growth_smoothing_tames_small_counts():
    # van 0 naar 1 winkel is geen +inf groei
    assert log_growth([0] * 7 + [1] * 7, 7, 3) == math.log(4 / 3)


def test_percentile_ranks_handles_ties():
    assert percentile_ranks([1, 2, 2, 3]) == [0, 0.5, 0.5, 1]
    assert percentile_ranks([5]) == [0.5]


def _population(extra: list[EntityInput]) -> list[EntityInput]:
    filler = [
        EntityInput(
            entity_id=100 + i, series={s: flat(10 + i) for s in Signal if s is not Signal.price}, store_count=30
        )
        for i in range(10)
    ]
    return filler + extra


def test_multi_signal_convergence_beats_single_signal():
    converging = EntityInput(
        entity_id=1,
        series={
            Signal.store: ramp(2, 12),
            Signal.ads: ramp(3, 30),
            Signal.search: ramp(20, 60),
            Signal.social: ramp(1000, 9000),
            Signal.marketplace: ramp(50, 200),
        },
        store_count=12,
        advertiser_count=8,
        margin=0.55,
    )
    single = EntityInput(
        entity_id=2,
        series={Signal.ads: ramp(1, 300), Signal.search: flat(20), Signal.store: flat(5)},
        store_count=5,
        advertiser_count=2,
        margin=0.55,
    )
    results = {r.entity_id: r for r in score_population(_population([converging, single]))}
    good, lone = results[1], results[2]
    assert good.validation > 60
    assert lone.validation <= 40, "minder dan 3 positieve signalen moet begrensd worden"
    assert "gate_min_signals" in lone.breakdown["notes"]
    assert "convergence_bonus" in good.breakdown["notes"]
    assert good.opportunity > lone.opportunity
    assert good.phase in {"emerging", "rising"}


def test_saturation_rises_with_supply():
    series = {Signal.store: flat(50), Signal.search: flat(20), Signal.ads: flat(10)}
    small = EntityInput(entity_id=1, series=series, store_count=3, advertiser_count=1)
    big = EntityInput(entity_id=2, series=series, store_count=400, advertiser_count=300)
    r = {x.entity_id: x for x in score_population([small, big])}
    assert r[2].saturation > 0.85 > 0.3 > r[1].saturation


def test_declining_phase():
    e = EntityInput(
        entity_id=1,
        series={Signal.search: ramp(100, 20), Signal.social: ramp(9000, 1000), Signal.store: flat(40)},
        store_count=40,
    )
    assert score_population([e])[0].phase == "declining"


def test_breakdown_shares_sum_to_one():
    r = score_population(_population([]))[0]
    assert abs(sum(s["share"] for s in r.breakdown["signals"]) - 1) < 1e-6
