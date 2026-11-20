"""HTML/JSON/XML zoals echte platforms ze serveren — dezelfde kenmerken waar de detectors op letten."""

from __future__ import annotations

import html as h
import json
from typing import Any

from trendscope.mockweb.baseline import StoreBaseline

# Shopify's standaard robots.txt (ingekort tot de regels die voor ons relevant zijn)
SHOPIFY_ROBOTS = """# we use Shopify as our ecommerce platform

User-agent: *
Disallow: /a/downloads/-/*
Disallow: /admin
Disallow: /cart
Disallow: /orders
Disallow: /checkouts/
Disallow: /checkout
Disallow: /carts
Disallow: /account
Disallow: /collections/*sort_by*
Disallow: /*/collections/*sort_by*
Disallow: /collections/*+*
Disallow: /collections/*%2B*
Disallow: /collections/*%2b*
Disallow: /blogs/*+*
Disallow: /*?*oseid=*
Disallow: /*preview_theme_id*
Disallow: /*preview_script_id*
Disallow: /policies/
Disallow: /search
Disallow: /recommendations/products
Sitemap: https://{domain}/sitemap.xml
"""

TECH_SNIPPETS: dict[str, str] = {
    "Meta Pixel": '<script>!function(f,b,e,v,n,t,s){}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init","1234567890");</script>',
    "TikTok Pixel": '<script>!function(w,d,t){ttq.load("C4ABCDEF");}(window,document,"ttq");</script><script src="https://analytics.tiktok.com/i18n/pixel/events.js"></script>',
    "Google Analytics 4": '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>',
    "Google Ads": '<script async src="https://www.googletagmanager.com/gtag/js?id=AW-987654321"></script>',
    "Google Tag Manager": "<script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i;})(window,document,'script','dataLayer','GTM-ABCD12');</script>",
    "Pinterest Tag": '<script>!function(e){pintrk("load","2612345")}("https://s.pinimg.com/ct/core.js");</script>',
    "Snap Pixel": '<script>(function(e,t,n){snaptr("init","abc-123")})(window,document,"https://sc-static.net/scevent.min.js");</script>',
    "Microsoft Advertising": '<script>(function(w,d,t,r,u){})(window,document,"script","//bat.bing.com/bat.js","uetq");</script>',
    "Taboola": '<script>!function(e,f,u,i){}(document.createElement("script"),document.getElementsByTagName("script")[0],"//cdn.taboola.com/libtrc/unip/123/tfa.js");</script>',
    "Reddit Pixel": '<script>!function(w,d){rdt("init","t2_abc");}(window,document);</script><script src="https://www.redditstatic.com/ads/pixel.js"></script>',
    "Klaviyo": '<script async src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=AbC123"></script>',
    "Postscript": '<script src="https://sdk.postscript.io/sdk.bundle.js?shopId=123"></script>',
    "Judge.me": '<script src="https://cdn.judge.me/widget_preloader.js"></script>',
    "Loox": '<script src="https://loox.io/widget/abc/loox.js"></script>',
    "Okendo": '<script src="https://cdn-static.okendo.io/reviews-widget-plus/js/okendo-reviews.js"></script>',
    "Yotpo": '<script src="https://cdn-widgetsrepository.yotpo.com/v1/loader/abc"></script>',
    "ReCharge": '<script src="https://static.rechargecdn.com/assets/js/widget.min.js"></script>',
    "Triple Whale": '<script>window.TriplePixelData={};</script><script src="https://config.triplewhale.com/triple.js"></script>',
    "Gorgias": '<script src="https://config.gorgias.chat/bundle-loader/abc"></script>',
    "Rebuy": '<script src="https://cdn.rebuyengine.com/onsite/js/rebuy.js"></script>',
    "PageFly": '<script src="https://cdn.pagefly.io/pagefly/core.js"></script>',
    "Shogun": '<script src="https://cdn.getshogun.com/f.js"></script>',
    "Intelligems": '<script src="https://cdn.intelligems.io/abc.js"></script>',
    "Vitals": '<script src="https://appsolve.io/vitals/abc.js"></script>',
    "Zipify Pages": '<script src="https://cdn.zipify.com/pages/abc.js"></script>',
}
PAYMENT_ICON = {
    "Shopify Payments": "shopify_pay",
    "PayPal": "paypal",
    "Klarna": "klarna",
    "Afterpay": "afterpay",
    "Apple Pay": "apple_pay",
    "iDEAL": "ideal",
}
SOCIAL_URL = {
    "instagram": "https://www.instagram.com/{}",
    "facebook": "https://www.facebook.com/{}",
    "tiktok": "https://www.tiktok.com/@{}",
    "pinterest": "https://www.pinterest.com/{}",
    "youtube": "https://www.youtube.com/@{}",
}


def _shared_head(store: StoreBaseline) -> str:
    return (
        f"<title>{h.escape(store.name)} – Official Store</title>"
        f'<meta name="description" content="{h.escape(store.name)}: free shipping on all orders.">'
        f'<meta property="og:site_name" content="{h.escape(store.name)}">'
        f'<link rel="alternate" hreflang="{store.language}" href="https://{store.domain}/">'
        f'<link rel="alternate" hreflang="x-default" href="https://{store.domain}/">'
    )


def _footer(store: StoreBaseline) -> str:
    socials = "".join(
        f'<a href="{SOCIAL_URL[k].format(v)}">{k}</a>' for k, v in store.social.items() if k in SOCIAL_URL
    )
    icons = "".join(
        f'<svg class="icon icon--full-color" aria-labelledby="pi-{PAYMENT_ICON[t]}"></svg>'
        for t in store.technologies
        if t in PAYMENT_ICON
    )
    share = f'<a href="https://www.facebook.com/sharer/sharer.php?u=https://{store.domain}">share</a>'
    return f"<footer>{socials}{share}<ul class='list-payment'>{icons}</ul></footer>"


def shopify_home(store: StoreBaseline) -> str:
    theme = {"name": store.theme, "id": 140000000000, "schema_name": store.theme, "theme_store_id": 887, "role": "main"}
    shop_var = (
        "<script>var Shopify = Shopify || {};\n"
        f'Shopify.shop = "{store.name.lower()}.myshopify.com";\n'
        f'Shopify.locale = "{store.language}";\n'
        f'Shopify.currency = {{"active":"{store.currency}","rate":"1.0"}};\n'
        f'Shopify.country = "{store.country}";\n'
        f"Shopify.theme = {json.dumps(theme)};\n"
        "Shopify.routes = Shopify.routes || {};\n</script>"
    )
    techs = "".join(TECH_SNIPPETS[t] for t in store.technologies if t in TECH_SNIPPETS)
    return (
        f'<!doctype html><html class="no-js" lang="{store.language}"><head>{_shared_head(store)}'
        f'<link rel="preconnect" href="https://cdn.shopify.com" crossorigin>{shop_var}'
        f'<script src="//{store.domain}/cdn/shop/t/12/assets/global.js" defer></script>{techs}</head>'
        f'<body class="gradient"><h1>{h.escape(store.name)}</h1>{_footer(store)}</body></html>'
    )


def other_platform_home(store: StoreBaseline) -> str:
    marker = {
        "woocommerce": '<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css"><body class="woocommerce-page">',
        "magento": '<script type="text/x-magento-init">{"*":{"mage/cookies":{}}}</script><link href="/static/version1700000000/frontend/Magento/luma/en_US/css/styles-m.css"><body>',
        "bigcommerce": '<script src="https://cdn11.bigcommerce.com/s-abc/stencil/theme.js"></script><script>var BCData = {};</script><body>',
        "wix": '<link href="https://static.wixstatic.com/frog/main.css"><body>',
        "none": "<body>",
    }[store.platform]
    techs = (
        "".join(TECH_SNIPPETS[t] for t in store.technologies[:2] if t in TECH_SNIPPETS)
        if store.platform != "none"
        else ""
    )
    return f'<!doctype html><html lang="{store.language}"><head>{_shared_head(store)}{techs}</head>{marker}<h1>{h.escape(store.name)}</h1></body></html>'


def shopify_product_json(p: dict[str, Any], store: StoreBaseline) -> dict[str, Any]:
    pid = int(p["id"])
    variants = [
        {
            "id": int(v["id"]),
            "title": v["title"],
            "option1": v["title"],
            "sku": f"{p['handle'][:8].upper()}-{i}",
            "requires_shipping": True,
            "taxable": True,
            "featured_image": None,
            "available": v["available"],
            "price": f"{v['price']:.2f}",
            "grams": 250,
            "compare_at_price": f"{p['compare_at_price']:.2f}" if p.get("compare_at_price") else None,
            "position": i + 1,
            "product_id": pid,
            "created_at": p["published_at"],
            "updated_at": p["published_at"],
        }
        for i, v in enumerate(p["variants"])
    ]
    return {
        "id": pid,
        "title": p["title"],
        "handle": p["handle"],
        "body_html": f"<p>{h.escape(p['title'])} by {h.escape(store.name)}.</p>",
        "published_at": p["published_at"],
        "created_at": p["published_at"],
        "updated_at": p["published_at"],
        "vendor": p.get("vendor") or store.name,
        "product_type": p.get("product_type") or "",
        "tags": p.get("tags", []),
        "variants": variants,
        "images": [
            {
                "id": pid + 1,
                "position": 1,
                "product_id": pid,
                "variant_ids": [],
                "src": p["image"],
                "width": 800,
                "height": 800,
            }
        ],
        "options": [{"name": "Title", "position": 1, "values": [v["title"] for v in p["variants"]]}],
    }


def collections_json(store: StoreBaseline, products: list[dict[str, Any]], has_bestsellers: bool) -> dict[str, Any]:
    cols = [
        {"id": 1, "title": "Home page", "handle": "frontpage", "products_count": min(8, len(products))},
        {"id": 2, "title": "All products", "handle": "all", "products_count": len(products)},
    ]
    if has_bestsellers:
        cols.append(
            {
                "id": 3,
                "title": "Best Sellers",
                "handle": "best-sellers",
                "products_count": sum(1 for p in products if p["best_seller_rank"]),
            }
        )
    return {
        "collections": [
            c
            | {
                "description": "",
                "published_at": "2025-01-01T00:00:00Z",
                "updated_at": "2025-01-01T00:00:00Z",
                "image": None,
            }
            for c in cols
        ]
    }


def sitemap_index(domain: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"<sitemap><loc>https://{domain}/sitemap_products_1.xml?from=1&amp;to=99999999999999</loc></sitemap>"
        f"<sitemap><loc>https://{domain}/sitemap_pages_1.xml</loc></sitemap></sitemapindex>"
    )


def sitemap_products(domain: str, products: list[dict[str, Any]]) -> str:
    urls = "".join(
        f"<url><loc>https://{domain}/products/{p['handle']}</loc><lastmod>{p['published_at']}</lastmod><changefreq>daily</changefreq></url>"
        for p in products
    )
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://{domain}/</loc></url>{urls}</urlset>'
