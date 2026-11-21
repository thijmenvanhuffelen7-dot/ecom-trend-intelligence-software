"""Marktplaats-clients en matching: signing, parsers, BSR-schatting, scoring. Geen netwerk of database."""

import hashlib
import hmac
import json
from decimal import Decimal

import httpx
import pytest

from trendscope.clustering.embed import default_embedder
from trendscope.clustering.engine import JOIN_THRESHOLD, containment, score_pair
from trendscope.marketplaces import aliexpress, amazon, cj
from trendscope.marketplaces.records import parse_days, parse_percent


def test_aliexpress_signature_is_hmac_sha256_over_sorted_params():
    params = {"method": "aliexpress.affiliate.product.query", "app_key": "123", "timestamp": "1700000000000", "b": "2"}
    expected = (
        hmac.new(
            b"geheim", b"app_key123b2methodaliexpress.affiliate.product.querytimestamp1700000000000", hashlib.sha256
        )
        .hexdigest()
        .upper()
    )
    assert aliexpress.sign(params, "geheim") == expected
    assert aliexpress.sign({**params, "sign": "x"}, "geheim") != "", "sign zelf hoort niet in de handtekening"


def test_aliexpress_parse_and_error():
    payload = {
        "aliexpress_affiliate_product_query_response": {
            "resp_result": {
                "resp_code": 200,
                "result": {
                    "total_record_count": 1,
                    "products": {
                        "product": [
                            {
                                "product_id": 1005001,
                                "product_title": "Portable Blender USB",
                                "target_sale_price": "7.99",
                                "target_sale_price_currency": "EUR",
                                "evaluate_rate": "94.0%",
                                "lastest_volume": 812,
                                "shop_id": 91,
                                "ship_to_days": "7-15",
                            }
                        ]
                    },
                },
            }
        }
    }
    listings, total = aliexpress.parse_response(json.dumps(payload).encode())
    assert total == 1
    (item,) = listings
    assert item.price == Decimal("7.99") and item.orders_30d == 812 and item.rating == 4.7
    assert item.shipping_days == (7, 15) and item.is_supplier
    with pytest.raises(Exception, match="IncompleteSignature"):
        aliexpress.parse_response(json.dumps({"error_response": {"code": "IncompleteSignature", "msg": "x"}}).encode())


def test_amazon_parse_items_and_bsr_estimate():
    payload = {
        "searchResult": {
            "items": [
                {
                    "asin": "B0TEST1234",
                    "detailPageURL": "https://www.amazon.de/dp/B0TEST1234",
                    "itemInfo": {"title": {"displayValue": "Lumenix Portable Blender"}},
                    "offersV2": {"listings": [{"price": {"money": {"amount": 29.95, "currency": "EUR"}}}]},
                    "browseNodeInfo": {"websiteSalesRank": {"salesRank": 1500, "displayName": "Home & Kitchen"}},
                },
                {"asin": "B0NOPRICE1", "itemInfo": {"title": {"displayValue": "Zonder prijs"}}},
            ]
        }
    }
    a, b = amazon.parse_items(json.dumps(payload).encode(), "www.amazon.de")
    assert a.price == Decimal("29.95") and a.sales_rank == 1500 and a.currency == "EUR"
    assert b.price is None and not a.is_supplier
    est = amazon.estimate_monthly_sales(1500, "Home & Kitchen")
    assert est and est["low"] < est["value"] < est["high"] and est["confidence"] == "low"
    worse = amazon.estimate_monthly_sales(50_000, "Home & Kitchen")
    assert worse and worse["value"] < est["value"], "hogere rang = minder verkopen"
    assert amazon.estimate_monthly_sales(None, None) is None


def test_cj_parse_and_failed_call():
    payload = {
        "code": 200,
        "result": True,
        "data": {"list": [{"pid": "ABC-1", "productNameEn": "Portable Blender", "sellPrice": "5.10"}]},
    }
    (item,) = cj.parse_list(json.dumps(payload).encode())
    assert item.source == "cj" and item.price == Decimal("5.10") and item.is_supplier
    with pytest.raises(Exception, match="Invalid token"):
        cj.parse_list(json.dumps({"code": 1600001, "result": False, "message": "Invalid token"}).encode())


def test_parsers_for_days_and_percent():
    assert parse_days("7-15") == (7, 15)
    assert parse_days("12") == (12, 12)
    assert parse_days(None) is None
    assert parse_percent("94.5%") == 94.5
    assert parse_percent("") is None


def _pair(a: str, b: str, img_a: int | None = None, img_b: int | None = None) -> float:
    score, _ = score_pair(a, default_embedder.embed(a), img_a, b, default_embedder.embed(b), img_b)
    return score


def test_long_marketplace_title_matches_short_cluster_title():
    assert containment("portable blender", "2026 New Portable Blender USB Rechargeable for Smoothies") == 1.0
    assert _pair("2026 New Portable Blender Rechargeable Gift Idea", "Portable Blender") >= JOIN_THRESHOLD
    assert _pair("Hot Sale Sunset Projection Lamp Durable", "Portable Blender") < 0.3


def test_image_evidence_lifts_and_sinks_scores():
    text_only = _pair("Brow Lamination Rechargeable", "Brow Lamination Kit")
    same_image = _pair("Brow Lamination Rechargeable", "Brow Lamination Kit", 0x0F0F_0F0F, 0x0F0F_0F0F)
    other_image = _pair("Brow Lamination Rechargeable", "Brow Lamination Kit", 0x0F0F_0F0F, ~0x0F0F_0F0F)
    assert other_image < text_only < same_image


def test_mock_aliexpress_rejects_wrong_signature():
    from trendscope.mockweb.transport import MockWebTransport

    transport = MockWebTransport(day=0)
    params = {"method": "aliexpress.affiliate.product.query", "app_key": "k", "keywords": "x", "sign": "FOUT"}
    res = transport.handle_request(httpx.Request("GET", "https://api-sg.aliexpress.com/sync", params=params))
    assert "IncompleteSignature" in res.text
