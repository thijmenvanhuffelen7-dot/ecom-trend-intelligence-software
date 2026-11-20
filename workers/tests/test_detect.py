from trendscope.detect.detector import detect
from trendscope.mockweb.baseline import StoreBaseline
from trendscope.mockweb.pages import other_platform_home, shopify_home


def _store(**kw):
    base = dict(
        domain="lumora.nl",
        name="Lumora",
        country="NL",
        currency="EUR",
        language="nl",
        theme="Dawn",
        arch="stable",
        color="hsl(1 1% 1%)",
        niches=["skincare"],
        social={"instagram": "lumora", "tiktok": "lumora.nl"},
        products=[],
        technologies=["Meta Pixel", "TikTok Pixel", "Google Analytics 4", "Klaviyo", "Judge.me", "PayPal", "iDEAL"],
    )
    return StoreBaseline(**(base | kw))


def test_detects_shopify_store_metadata_and_technologies():
    d = detect(shopify_home(_store()), {"x-shopid": "1", "powered-by": "Shopify"}, {"_shopify_y"})
    assert d.platform == "shopify"
    assert {"html:cdn\\.shopify\\.com", "header:x-shopid", "cookie:_shopify_y"} <= set(d.platform_evidence)
    assert (d.name, d.currency, d.country, d.language, d.theme) == ("Lumora", "EUR", "NL", "nl", "Dawn")
    assert d.shopify_domain == "lumora.myshopify.com"
    assert dict((n, t) for t, n in d.technologies) == {
        "Meta Pixel": "pixel",
        "TikTok Pixel": "pixel",
        "Google Analytics 4": "analytics",
        "Klaviyo": "email",
        "Judge.me": "reviews",
        "PayPal": "payment",
        "iDEAL": "payment",
    }
    # deel-knoppen ('sharer') zijn geen social-account
    assert d.social == {"instagram": "lumora", "tiktok": "lumora.nl"}


def test_detects_other_platforms():
    for platform in ["woocommerce", "magento", "bigcommerce", "wix"]:
        assert detect(other_platform_home(_store(platform=platform))).platform == platform
    assert detect(other_platform_home(_store(platform="none"))).platform == "unknown"


def test_ga4_is_not_mistaken_for_google_ads():
    html = '<script src="https://www.googletagmanager.com/gtag/js?id=G-XYZ"></script>'
    names = {n for _, n in detect(html).technologies}
    assert names == {"Google Analytics 4"}


def test_title_fallback_and_hreflang():
    html = '<html lang="de-DE"><head><title>Bergwerk | Outdoor</title><link rel="alternate" hreflang="en-GB" href="x"></head>'
    d = detect(html)
    assert d.name == "Bergwerk"
    assert d.languages == ["de", "en"]
