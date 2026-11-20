from decimal import Decimal

from trendscope.discovery.ct_logs import extract_domains
from trendscope.pipeline.diff import ProductState, VariantState, diff_catalog, diff_technologies
from trendscope.pipeline.matching import normalize_title
from trendscope.scheduler.priority import DAY, HOUR, compute_schedule


def state(pid, price="19.95", available=True, variants=("1",), title="Mug", compare=None):
    return ProductState(
        pid,
        f"h-{pid}",
        title,
        Decimal(price),
        Decimal(compare) if compare else None,
        available,
        tuple(VariantState(v, v, Decimal(price), available) for v in variants),
    )


def test_diff_detects_every_change_type():
    prev = {"a": state("a"), "b": state("b"), "c": state("c", available=True), "d": state("d", variants=("1", "2"))}
    cur = {
        "a": state("a", price="17.95", compare="29.95"),  # prijs + vergelijkprijs
        "c": state("c", available=False),  # uitverkocht
        "d": state("d", variants=("1", "3"), title="Mug XL"),  # variant weg + bij, nieuwe titel
        "e": state("e"),  # nieuw
    }
    types = [(e.type, e.external_id) for e in diff_catalog(prev, cur)]
    assert types == [
        ("product_added", "e"),
        ("product_removed", "b"),
        ("price_changed", "a"),
        ("compare_at_changed", "a"),
        ("out_of_stock", "c"),
        ("variants_added", "d"),
        ("variants_removed", "d"),
        ("title_changed", "d"),
    ]
    price = next(e for e in diff_catalog(prev, cur) if e.type == "price_changed")
    assert price.payload["old"] == 19.95 and price.payload["new"] == 17.95 and price.payload["pct"] == -10.0


def test_diff_ignores_rounding_noise_and_is_empty_when_unchanged():
    assert diff_catalog({"a": state("a")}, {"a": state("a")}) == []
    assert diff_catalog({"a": state("a", price="19.950")}, {"a": state("a", price="19.95")}) == []


def test_tech_diff_by_name():
    assert [(e.type, e.external_id) for e in diff_technologies({"Klaviyo", "Loox"}, {"Klaviyo", "Okendo"})] == [
        ("tech_added", "Okendo"),
        ("tech_removed", "Loox"),
    ]


def test_normalize_title_strips_variants_and_marketing():
    assert normalize_title("Mini Massage Gun — Limited Edition (2-Pack)") == "massage gun"
    assert normalize_title("NEW Posture Corrector Pro | Official Store") == "posture corrector"
    assert normalize_title("Crème Éclat 50ml") == "creme eclat"


def test_schedule_hot_normal_sleepy_and_backoff():
    hot = compute_schedule(watchers=2, monthly_visits=500_000, changes_7d=1)
    normal = compute_schedule(monthly_visits=500_000, changes_7d=1)
    sleepy = compute_schedule(monthly_visits=2_000)
    failing = compute_schedule(monthly_visits=500_000, changes_7d=1, failures=3)
    assert hot.interval_secs == 6 * HOUR and hot.priority < normal.priority
    assert normal.interval_secs == DAY
    assert sleepy.interval_secs == 3 * DAY
    assert failing.interval_secs == 7 * DAY and failing.priority > normal.priority
    assert compute_schedule(age_days=5).interval_secs == 6 * HOUR


def test_ct_domain_extraction():
    entries = [
        {"name_value": "lumora.nl\nwww.lumora.nl\nmail.lumora.nl", "common_name": "lumora.nl"},
        {"name_value": "*.cdn-thing.net\nfoo.myshopify.com\nnot a domain\nshop.velostore.co.uk"},
    ]
    assert extract_domains(entries) == {"lumora.nl", "velostore.co.uk"}
