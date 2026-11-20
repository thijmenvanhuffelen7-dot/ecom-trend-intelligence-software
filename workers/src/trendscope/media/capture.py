"""Creatives uitlezen uit Meta-snapshots en winkelscreenshots maken.

Echte Meta-snapshots zijn JavaScript-pagina's: live renderen we ze met Playwright en lezen we de DOM.
De statische HTML van het nep-internet lezen we met dezelfde extractor, zodat die logica getest is.
"""

from __future__ import annotations

import html as h
import re
from dataclasses import dataclass, field
from typing import Any

from trendscope.core.http import PoliteHttpClient


@dataclass
class SnapshotCreative:
    format: str | None = None
    media: list[dict[str, Any]] = field(default_factory=list)
    cta: str | None = None
    landing_url: str | None = None


def extract_snapshot(html: str) -> SnapshotCreative:
    c = SnapshotCreative()
    videos = re.findall(r"<video\b[^>]*>", html, re.I)
    images = re.findall(r'<img\b[^>]*class="[^"]*creative[^"]*"[^>]*>|<img\b[^>]*>', html, re.I)
    for v in videos:
        src = re.search(r'\bsrc="([^"]+)"', v)
        poster = re.search(r'\bposter="([^"]+)"', v)
        if src:
            c.media.append(
                {
                    "type": "video",
                    "url": h.unescape(src.group(1)),
                    "poster": h.unescape(poster.group(1)) if poster else None,
                    "storage_key": None,
                }
            )
    if not videos:
        for img in images[:10]:
            src = re.search(r'\bsrc="([^"]+)"', img)
            if src and not src.group(1).startswith("data:"):
                c.media.append({"type": "image", "url": h.unescape(src.group(1)), "poster": None, "storage_key": None})
    fmt = re.search(r'data-format="(\w+)"', html)
    c.format = (
        fmt.group(1)
        if fmt
        else ("video" if videos else "carousel" if len(c.media) > 1 else "image" if c.media else None)
    )
    cta = re.search(r'<a\b[^>]*class="[^"]*cta[^"]*"[^>]*>(.*?)</a>', html, re.I | re.S)
    if cta:
        c.cta = re.sub(r"<[^>]+>", "", cta.group(1)).strip() or None
        href = re.search(r'href="([^"]+)"', cta.group(0))
        c.landing_url = h.unescape(href.group(1)) if href else None
    return c


def fetch_meta_snapshot(client: PoliteHttpClient, snapshot_url: str, token: str) -> SnapshotCreative:
    sep = "&" if "?" in snapshot_url else "?"
    return extract_snapshot(client.get(f"{snapshot_url}{sep}access_token={token}").text)


def screenshot(
    url: str, *, chrome_path: str | None = None, width: int = 1280, height: int = 800, route_html: str | None = None
) -> bytes:  # pragma: no cover - vereist een browser
    """PNG van een pagina. `route_html` levert de pagina zelf (tests/nep-internet) i.p.v. het netwerk."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chrome_path)
        try:
            page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
            if route_html is not None:
                page.route(
                    "**/*",
                    lambda route: (
                        route.fulfill(status=200, content_type="text/html; charset=utf-8", body=route_html)
                        if route.request.resource_type == "document"
                        else route.abort()
                    ),
                )
            page.goto(url, wait_until="load", timeout=30_000)
            return page.screenshot(type="png")
        finally:
            browser.close()
