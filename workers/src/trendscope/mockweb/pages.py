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
    "Privy": '<script src="https://widget.privy.com/assets/widget.js"></script>',
    "Justuno": '<script src="https://cdn.justuno.com/vck.js"></script>',
    "OptiMonk": '<script src="https://onsite.optimonk.com/script.js?account=123"></script>',
    "Wheelio": '<script src="https://wheelioapp.azureedge.net/app/index.min.js"></script>',
    "Hextom Free Shipping Bar": '<script src="https://cdn.hextom.com/js/freeshippingbar.js"></script>',
    "Hurrify": '<script src="https://hurrify.app/countdown.js"></script>',
    "Sales Pop": '<script src="https://cdn.salespop.app/salespop.js"></script>',
    "Frequently Bought Together": '<script src="https://cdn.codeblackbelt.com/js/modules/frequently-bought-together/main.min.js"></script>',
    "Bold Upsell": '<script src="https://upsells.boldapps.net/v2_ui/js/UpsellTracker.js"></script>',
    "Smile.io": '<script src="https://js.smile.io/v1/smile-shopify.js"></script>',
    "LoyaltyLion": '<script src="https://sdk.loyaltylion.net/static/2/loader.js"></script>',
    "Octane AI": '<script src="https://app.octaneai.com/js/shop.js"></script>',
    "Tidio": '<script src="https://code.tidio.co/abc.js"></script>',
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
        '<meta charset="utf-8">'
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


def _storefront_body(store: StoreBaseline, products: list[dict[str, Any]] | None = None) -> str:
    """Een geloofwaardige storefront in inline CSS (geen externe bronnen), zodat screenshots op een winkel lijken."""
    items = (products or store.products)[:4]
    cards = "".join(
        f'<div class="card"><div class="img" style="background:hsl({(i * 47 + len(store.name) * 13) % 360} 45% 88%)"></div>'
        f'<p class="t">{h.escape(p["title"][:34])}</p><p class="p">€ {p["price"]:.2f}</p></div>'
        for i, p in enumerate(items)
    )
    return (
        f"<style>*{{box-sizing:border-box;margin:0}}body{{font-family:Helvetica,Arial,sans-serif;color:#111;background:#fff}}"
        f".bar{{background:{store.color};color:#fff;text-align:center;font-size:12px;letter-spacing:.08em;padding:8px}}"
        f"nav{{display:flex;align-items:center;justify-content:space-between;padding:22px 48px;border-bottom:1px solid #eee}}"
        f"nav b{{font-size:26px;letter-spacing:-.02em}}nav span{{margin-left:28px;color:#555;font-size:14px}}"
        f".hero{{display:grid;grid-template-columns:1.1fr 1fr;align-items:center;gap:40px;padding:56px 48px;"
        f"background:linear-gradient(120deg,color-mix(in oklab,{store.color} 16%,white),#fff)}}"
        f".hero h1{{font-size:54px;line-height:1.02;letter-spacing:-.03em}}.hero p{{margin:18px 0 26px;color:#444;font-size:17px}}"
        f".btn{{display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:999px;font-weight:700}}"
        f".blob{{height:300px;border-radius:32px;background:radial-gradient(circle at 30% 30%,#fff,{store.color})}}"
        f".grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:36px 48px}}"
        f".img{{aspect-ratio:1;border-radius:14px}}.t{{margin-top:10px;font-size:14px}}.p{{font-weight:700;margin-top:4px}}</style>"
        f'<div class="bar">FREE SHIPPING ON ALL ORDERS · 30-DAY RETURNS</div>'
        f"<nav><b>{h.escape(store.name)}</b><div><span>Shop</span><span>Bestsellers</span><span>About</span><span>Cart (0)</span></div></nav>"
        f'<section class="hero"><div><h1>Feel the difference with {h.escape(store.name)}.</h1>'
        f'<p>Loved by 20,000+ customers. Rated 4.8/5.</p><a class="btn">Shop now</a></div><div class="blob"></div></section>'
        f'<section class="grid">{cards}</section>'
    )


def shopify_home(store: StoreBaseline, products: list[dict[str, Any]] | None = None) -> str:
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
        f'<body class="gradient">{_storefront_body(store, products)}{_footer(store)}</body></html>'
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
    body = (
        _storefront_body(store) if store.platform != "none" else f"<h1>{h.escape(store.name)}</h1><p>Coming soon.</p>"
    )
    return f'<!doctype html><html lang="{store.language}"><head>{_shared_head(store)}{techs}</head>{marker}{body}</body></html>'


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
