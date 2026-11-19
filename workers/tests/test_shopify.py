from decimal import Decimal

from trendscope.connectors.base import get_connector, load_manifests
from trendscope.connectors.shopify.connector import parse_products_json
from trendscope.core.settings import Settings


def test_parse_fixture():
    connector = get_connector("shopify_storefront", Settings(data_mode="mock"))
    products = connector.run("brightnest.example")
    assert len(products) == 2
    p = products[0]
    assert p.title == "CloudPress Posture Corrector"
    assert p.price == Decimal("34.95")
    assert p.compare_at_price == Decimal("59.95")
    assert p.available is True
    assert len(p.variants) == 3
    assert p.url == "https://brightnest.example/products/cloudpress-posture-corrector"
    second = products[1]
    assert second.tags == ["home decor", "kids", "night light"]
    assert second.product_type is None
    assert second.compare_at_price is None


def test_content_hash_ignores_irrelevant_changes():
    raw = b'{"products":[{"id":1,"title":"A","handle":"a","variants":[{"id":2,"price":"19.90","available":true}]}]}'
    raw2 = raw.replace(b'"A"', b'"A renamed"').replace(b"19.90", b"19.9")
    assert parse_products_json("x", raw)[0].content_hash == parse_products_json("x", raw2)[0].content_hash
    raw3 = raw.replace(b"19.90", b"17.90")
    assert parse_products_json("x", raw)[0].content_hash != parse_products_json("x", raw3)[0].content_hash


def test_manifests_valid():
    manifests = load_manifests()
    assert "shopify_storefront" in manifests
    assert manifests["shopify_storefront"].respects_robots_txt
