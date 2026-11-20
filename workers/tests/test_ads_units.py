from datetime import date
from pathlib import Path

import pytest

from trendscope.ads import google, meta, tiktok
from trendscope.ads.estimates import estimate_reach, estimate_spend
from trendscope.ads.records import AdRecord, landing_domain
from trendscope.media.capture import extract_snapshot
from trendscope.media.storage import image_size, put_asset

FIX = Path(__file__).parents[1] / "src/trendscope/connectors"
TODAY = date(2026, 10, 21)


def test_meta_parse_fixture_and_strip_token():
    ads, next_url = meta.parse_page((FIX / "meta_ads/fixtures/ads_archive_page1.json").read_bytes(), TODAY)
    a, b = ads
    assert (a.platform, a.advertiser_external_id, a.advertiser_name) == ("meta", "104512345678901", "Brightnest")
    assert a.landing_domain == "brightnest.nl" and b.landing_domain == "brightnest.nl"
    assert a.countries == ["BE", "NL"] and a.publisher_platforms == ["facebook", "instagram"]
    assert a.is_active and a.eu_reach == 48213 and a.target_ages == "25–65+"
    assert not b.is_active and b.end_date == date(2026, 9, 30)
    # het access token mag nooit in de database belanden
    assert "access_token" not in (a.snapshot_url or "") and "SECRET" not in (a.snapshot_url or "")
    assert next_url and "after=QVFIUj" in next_url


def test_meta_api_error_is_raised():
    with pytest.raises(RuntimeError, match="190"):
        meta.parse_page(b'{"error": {"code": 190, "message": "Invalid OAuth access token"}}', TODAY)


def test_tiktok_parse_fixture():
    import json

    data = json.loads((FIX / "tiktok_ads/fixtures/ad_query.json").read_text())
    ad = tiktok.parse_ad(data["data"]["ads"][0], TODAY, "NL")
    assert ad.format == "video" and ad.is_active and ad.start_date == date(2026, 10, 1)
    assert (ad.impressions_low, ad.impressions_high) == (10_000, 100_000)
    assert ad.media[0].poster == "https://p16.tiktokcdn.com/cover.jpeg"
    assert ad.advertiser_external_id == "7123456789012345678"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1K-10K", (1000, 10000)),
        ("1M+", (1_000_000, None)),
        ({"unique_users_seen": "100-1K"}, (100, 1000)),
        (12345, (12345, 12345)),
        (None, (None, None)),
    ],
)
def test_tiktok_reach_ranges(raw, expected):
    assert tiktok.parse_reach(raw) == expected


def test_google_rows_merge_regions():
    rows = [
        {
            "advertiser_id": "AR1",
            "advertiser_disclosed_name": "Lumora",
            "creative_id": "CR1",
            "creative_page_url": "u",
            "ad_format_type": "VIDEO",
            "region_code": "NL",
            "first_shown": "2026-09-01",
            "last_shown": "2026-10-21",
            "times_shown_lower_bound": 1000,
            "times_shown_upper_bound": 10000,
        },
        {
            "advertiser_id": "AR1",
            "advertiser_disclosed_name": "Lumora",
            "creative_id": "CR1",
            "creative_page_url": "u",
            "ad_format_type": "VIDEO",
            "region_code": "DE",
            "first_shown": "2026-08-15",
            "last_shown": "2026-10-01",
            "times_shown_lower_bound": 0,
            "times_shown_upper_bound": 1000,
        },
        {
            "advertiser_id": "AR1",
            "creative_id": "CR1",
            "region_code": "EEA",
            "first_shown": "2026-08-15",
            "last_shown": "2026-10-21",
            "times_shown_lower_bound": 99999,
            "times_shown_upper_bound": 999999,
        },
    ]
    (ad,) = google.parse_rows(rows, TODAY)
    assert ad.format == "video" and ad.countries == ["DE", "NL"] and ad.is_active
    assert ad.start_date == date(2026, 8, 15)
    assert (ad.impressions_low, ad.impressions_high) == (1000, 11000), "EEA-totaal niet dubbel tellen"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://www.Lumora.nl/products/x?utm=1", "lumora.nl"),
        ("LUMORA.NL", "lumora.nl"),
        ("shop.lumora.co.uk", "lumora.co.uk"),
        ("Free shipping", None),
        (None, None),
    ],
)
def test_landing_domain(value, expected):
    assert landing_domain(value) == expected


def test_variants_share_creative_hash():
    a = AdRecord(
        platform="meta",
        external_id="1",
        advertiser_external_id="p",
        advertiser_name="x",
        body="Hello  World!",
        headline="Mug",
    )
    b = a.model_copy(update={"external_id": "2", "body": "hello world", "countries": ["NL"]})
    c = a.model_copy(update={"external_id": "3", "headline": "Other"})
    assert a.creative_hash == b.creative_hash != c.creative_hash


def test_reach_estimates_label_their_method():
    exact = AdRecord(
        platform="meta",
        external_id="1",
        advertiser_external_id="p",
        advertiser_name="x",
        eu_reach=5000,
        countries=["NL"],
    )
    r = estimate_reach(exact, 1, TODAY)
    assert r["confidence"] == "high" and r["low"] == r["high"] == 5000
    spend = estimate_spend(r, ["NL"])
    assert spend["currency"] == "EUR" and spend["low"] < spend["value"] < spend["high"]

    heuristic = AdRecord(
        platform="meta",
        external_id="2",
        advertiser_external_id="p",
        advertiser_name="x",
        start_date=date(2026, 9, 21),
        countries=["NL", "BE"],
    )
    one = estimate_reach(heuristic, 1, TODAY)
    many = estimate_reach(heuristic, 5, TODAY)
    assert one["confidence"] == "low" and "heuristiek" in one["method"]
    assert many["value"] > one["value"], "meer varianten = meer budget"
    assert estimate_reach(heuristic.model_copy(update={"start_date": None}), 1, TODAY) is None


def test_snapshot_extraction():
    html = (
        '<div class="ad" data-format="video"><video poster="/p.jpg" src="/v.mp4"></video>'
        '<a href="https://lumora.nl/products/mug" class="cta">Shop Now</a></div>'
    )
    c = extract_snapshot(html)
    assert c.format == "video" and c.media == [
        {"type": "video", "url": "/v.mp4", "poster": "/p.jpg", "storage_key": None}
    ]
    assert c.cta == "Shop Now" and c.landing_url == "https://lumora.nl/products/mug"
    carousel = extract_snapshot('<img src="/a.jpg"><img src="/b.jpg"><img src="data:image/gif;base64,x">')
    assert carousel.format == "carousel" and len(carousel.media) == 2


def test_image_size_from_headers():
    png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (640).to_bytes(4, "big") + (480).to_bytes(4, "big")
    assert image_size(png, "image/png") == (640, 480)
    assert image_size(b"GIF89a" + (32).to_bytes(2, "little") + (16).to_bytes(2, "little"), "image/gif") == (32, 16)


def test_put_asset_rejects_unknown_types():
    with pytest.raises(ValueError, match="Niet-toegestaan"):
        put_asset(b"<html>", "text/html", client=object())
