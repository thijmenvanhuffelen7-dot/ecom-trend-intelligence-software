"""Platform-, technologie- en metadatadetectie uit een homepage (HTML + headers + cookies)."""

from __future__ import annotations

import contextlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from urllib.parse import urlsplit

from trendscope.detect.signatures import PLATFORMS, TECHNOLOGIES, Signature

SOCIAL_HOSTS = {
    "instagram": ("instagram.com",),
    "facebook": ("facebook.com", "fb.com"),
    "tiktok": ("tiktok.com",),
    "youtube": ("youtube.com", "youtu.be"),
    "pinterest": ("pinterest.com", "pinterest.nl", "pinterest.co.uk"),
    "x": ("twitter.com", "x.com"),
}
_SOCIAL_SKIP = {"sharer", "share", "intent", "dialog", "plugins", "tr", "p", "pin", "watch", "embed"}


@dataclass
class Detection:
    platform: str = "unknown"
    platform_evidence: list[str] = field(default_factory=list)
    technologies: list[tuple[str, str]] = field(default_factory=list)  # (type, name)
    name: str | None = None
    description: str | None = None
    currency: str | None = None
    language: str | None = None
    languages: list[str] = field(default_factory=list)
    country: str | None = None
    theme: str | None = None
    shopify_domain: str | None = None
    social: dict[str, str] = field(default_factory=dict)


@lru_cache(maxsize=1)
def _compiled() -> list[tuple[Signature, tuple[re.Pattern[str], ...]]]:
    return [(s, s.compiled()) for s in [*PLATFORMS, *TECHNOLOGIES]]


def _matches(
    sig: Signature, patterns: tuple[re.Pattern[str], ...], html: str, headers: Mapping[str, str], cookies: set[str]
) -> list[str]:
    evidence = [f"html:{p.pattern}" for p in patterns if p.search(html)]
    lower = {k.lower(): v for k, v in headers.items()}
    for rule in sig.headers:
        name, _, pattern = rule.partition(":")
        hits = [k for k in lower if k == name or (name.endswith("-") and k.startswith(name))]
        for k in hits:
            if not pattern or re.search(pattern, lower[k], re.IGNORECASE):
                evidence.append(f"header:{k}")
    evidence += [f"cookie:{c}" for c in sig.cookies if c in cookies]
    return evidence


def _meta(html: str, attr: str, value: str) -> str | None:
    m = re.search(
        rf'<meta[^>]+{attr}=["\']{re.escape(value)}["\'][^>]*content=["\']([^"\']*)["\']', html, re.I
    ) or re.search(rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*{attr}=["\']{re.escape(value)}["\']', html, re.I)
    if not m:
        return None
    return m.group(1).strip() or None


def _shopify_js(html: str, key: str) -> str | None:
    m = re.search(rf"Shopify\.{key}\s*=\s*(.+?);\s*(?:\n|Shopify\.|</script>|var )", html)
    return m.group(1).strip() if m else None


def _social(html: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for href in re.findall(r'href=["\'](https?://[^"\']+)["\']', html, re.I):
        parts = urlsplit(href)
        host = parts.netloc.lower().removeprefix("www.").removeprefix("m.")
        handle = parts.path.strip("/").split("/")[0].lstrip("@") if parts.path.strip("/") else ""
        if not handle or handle.lower() in _SOCIAL_SKIP:
            continue
        for net, hosts in SOCIAL_HOSTS.items():
            if host in hosts and net not in out:
                out[net] = handle
    return out


def detect(html: str, headers: Mapping[str, str] | None = None, cookies: set[str] | None = None) -> Detection:
    headers = headers or {}
    cookies = cookies or set()
    d = Detection()

    best: tuple[int, str, list[str]] = (0, "unknown", [])
    for sig, patterns in _compiled():
        evidence = _matches(sig, patterns, html, headers, cookies)
        if not evidence:
            continue
        if sig.type == "platform":
            if len(evidence) > best[0]:
                best = (len(evidence), sig.name, evidence)
        else:
            d.technologies.append((sig.type, sig.name))
    d.platform, d.platform_evidence = best[1], best[2]

    lang = re.search(r"<html[^>]*\blang=[\"']([a-zA-Z-]+)", html)
    d.language = lang.group(1).split("-")[0].lower() if lang else None
    alternates = re.findall(r'<link[^>]+hreflang=["\']([a-zA-Z-]+)["\']', html, re.I)
    d.languages = sorted(
        {a.split("-")[0].lower() for a in alternates if a.lower() != "x-default"}
        | ({d.language} if d.language else set())
    )
    d.name = _meta(html, "property", "og:site_name")
    if not d.name:
        title = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
        d.name = re.split(r"\s[|–—-]\s", title.group(1).strip())[0] if title else None
    d.description = _meta(html, "name", "description")
    d.social = _social(html)

    if d.platform == "shopify":
        shop = _shopify_js(html, "shop")
        d.shopify_domain = json.loads(shop) if shop and shop.startswith('"') else None
        currency = _shopify_js(html, "currency")
        if currency:
            with contextlib.suppress(json.JSONDecodeError, AttributeError):
                d.currency = json.loads(currency).get("active")
        country = _shopify_js(html, "country")
        d.country = json.loads(country) if country and country.startswith('"') else None
        locale = _shopify_js(html, "locale")
        if locale and locale.startswith('"'):
            d.language = json.loads(locale).split("-")[0]
            d.languages = sorted(set(d.languages) | {d.language})
        theme = _shopify_js(html, "theme")
        if theme:
            with contextlib.suppress(json.JSONDecodeError, AttributeError):
                d.theme = json.loads(theme).get("name")
    if not d.currency:
        m = re.search(r'property=["\']og:price:currency["\'][^>]*content=["\']([A-Z]{3})', html)
        d.currency = m.group(1) if m else None
    return d
