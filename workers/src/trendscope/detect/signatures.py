"""Herkenningsregels voor platforms en technologieën.

Elke regel zoekt naar kenmerken die de technologie zelf in de pagina zet (script-URL's, globale
JS-variabelen, cookies, headers). We lezen alleen wat een gewone browser ook ontvangt.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Signature:
    name: str
    type: str  # platform | pixel | app | email | reviews | payment | analytics
    html: tuple[str, ...] = ()  # regexen over de ruwe HTML
    headers: tuple[str, ...] = ()  # "header-naam" of "header-naam:regex"
    cookies: tuple[str, ...] = ()

    def compiled(self) -> tuple[re.Pattern[str], ...]:
        return tuple(re.compile(p, re.IGNORECASE) for p in self.html)


PLATFORMS: list[Signature] = [
    Signature(
        "shopify",
        "platform",
        html=(r"cdn\.shopify\.com", r"Shopify\.theme\s*=", r"myshopify\.com"),
        headers=("x-shopid", "x-shopify-stage", "powered-by:shopify"),
        cookies=("_shopify_y", "_shopify_s"),
    ),
    Signature(
        "woocommerce",
        "platform",
        html=(r"wp-content/plugins/woocommerce", r"\bwoocommerce-(?:page|cart|js)\b", r"wc-block-"),
        cookies=("woocommerce_items_in_cart",),
    ),
    Signature(
        "magento",
        "platform",
        html=(r"Magento_[A-Z]\w+/", r"\bmage/cookies", r"/static/version\d+/frontend/"),
        cookies=("form_key", "mage-cache-sessid"),
    ),
    Signature("bigcommerce", "platform", html=(r"cdn\d*\.bigcommerce\.com", r"\bBCData\b"), headers=("x-bc-",)),
    Signature("wix", "platform", html=(r"static\.wixstatic\.com", r"\bwixBiSession\b"), headers=("x-wix-request-id",)),
]

TECHNOLOGIES: list[Signature] = [
    # Pixels / advertentie-tags
    Signature("Meta Pixel", "pixel", html=(r"connect\.facebook\.net/[\w_]+/fbevents\.js", r"\bfbq\(\s*['\"]init")),
    Signature("TikTok Pixel", "pixel", html=(r"analytics\.tiktok\.com/i18n/pixel", r"\bttq\.load\(")),
    Signature(
        "Google Ads",
        "pixel",
        html=(r"googletagmanager\.com/gtag/js\?id=AW-", r"gtag\(\s*['\"]config['\"]\s*,\s*['\"]AW-"),
    ),
    Signature(
        "Google Analytics 4",
        "analytics",
        html=(r"googletagmanager\.com/gtag/js\?id=G-", r"gtag\(\s*['\"]config['\"]\s*,\s*['\"]G-"),
    ),
    Signature("Google Tag Manager", "analytics", html=(r"googletagmanager\.com/gtm\.js", r"GTM-[A-Z0-9]{4,}")),
    Signature("Pinterest Tag", "pixel", html=(r"s\.pinimg\.com/ct/core\.js", r"\bpintrk\(")),
    Signature("Snap Pixel", "pixel", html=(r"sc-static\.net/scevent\.min\.js", r"\bsnaptr\(")),
    Signature("Microsoft Advertising", "pixel", html=(r"bat\.bing\.com/bat\.js",)),
    Signature("Taboola", "pixel", html=(r"cdn\.taboola\.com/libtrc",)),
    Signature("Reddit Pixel", "pixel", html=(r"redditstatic\.com/ads/pixel\.js", r"\brdt\(\s*['\"]init")),
    # E-mail / SMS
    Signature("Klaviyo", "email", html=(r"static\.klaviyo\.com/onsite/js", r"klaviyo\.com/media/js")),
    Signature("Omnisend", "email", html=(r"omnisnippet1\.com", r"omnisrc\.com")),
    Signature("Mailchimp", "email", html=(r"chimpstatic\.com", r"list-manage\.com")),
    Signature("Postscript", "email", html=(r"sdk\.postscript\.io",)),
    # Reviews
    Signature("Judge.me", "reviews", html=(r"cdn\.judge\.me", r"judge\.me/reviews")),
    Signature("Loox", "reviews", html=(r"loox\.io/widget",)),
    Signature("Okendo", "reviews", html=(r"cdn-static\.okendo\.io", r"okendo-reviews")),
    Signature("Yotpo", "reviews", html=(r"staticw2\.yotpo\.com", r"cdn-widgetsrepository\.yotpo\.com")),
    # Apps
    Signature("ReCharge", "app", html=(r"rechargecdn\.com", r"rechargepayments\.com")),
    Signature("Triple Whale", "app", html=(r"config\.triplewhale\.com", r"\bTriplePixel\b")),
    Signature("Gorgias", "app", html=(r"config\.gorgias\.chat", r"gorgias\.chat/bundle")),
    Signature("Rebuy", "app", html=(r"rebuyengine\.com",)),
    Signature("PageFly", "app", html=(r"cdn\.pagefly\.io", r"__pagefly")),
    Signature("Shogun", "app", html=(r"cdn\.getshogun\.com", r"\bshogun-frontend\b")),
    Signature("Intelligems", "app", html=(r"cdn\.intelligems\.io",)),
    Signature("Vitals", "app", html=(r"appsolve\.io",)),
    Signature("Zipify Pages", "app", html=(r"zipify\.com", r"\bzipify-pages\b")),
    # Betalen (Shopify-thema's renderen betaalicoontjes met aria-labelledby="pi-<naam>")
    Signature("Shopify Payments", "payment", html=(r"pi-shopify_pay", r"shop-pay-wallet", r"pi-shop_pay")),
    Signature("PayPal", "payment", html=(r"pi-paypal", r"paypal\.com/sdk/js")),
    Signature("Klarna", "payment", html=(r"pi-klarna", r"js\.klarna\.com")),
    Signature("Afterpay", "payment", html=(r"pi-afterpay", r"js\.afterpay\.com", r"static\.afterpay\.com")),
    Signature("Apple Pay", "payment", html=(r"pi-apple_pay",)),
    Signature("iDEAL", "payment", html=(r"pi-ideal",)),
]
