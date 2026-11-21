"""Procedurele productfoto's (PNG) voor het nep-internet.

Elk product heeft een vaste 'visuele identiteit' (vormen/kleuren uit een seed). Elke listing toont die
met kleine verschillen (uitsnede, helderheid, achtergrond), zoals echte verkopers dezelfde
fabrieksfoto net anders gebruiken. Zo kan de pHash-matching echt getest worden.
"""

from __future__ import annotations

import io
import random
from functools import lru_cache

from PIL import Image, ImageDraw, ImageEnhance

SIZE = 480


@lru_cache(maxsize=512)
def _base(visual_seed: str) -> Image.Image:
    r = random.Random(f"img:{visual_seed}")
    hue_bg = tuple(r.randint(225, 250) for _ in range(3))
    img = Image.new("RGB", (SIZE, SIZE), hue_bg)
    d = ImageDraw.Draw(img)
    main = tuple(r.randint(30, 200) for _ in range(3))
    # 'product': een hoofdvorm met accenten
    cx, cy = SIZE // 2 + r.randint(-40, 40), SIZE // 2 + r.randint(-30, 30)
    w, h = r.randint(140, 220), r.randint(160, 260)
    if r.random() < 0.5:
        d.rounded_rectangle([cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2], radius=r.randint(10, 60), fill=main)
    else:
        d.ellipse([cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2], fill=main)
    for _ in range(r.randint(3, 6)):
        x, y = r.randint(60, SIZE - 120), r.randint(60, SIZE - 120)
        s = r.randint(30, 90)
        d.ellipse([x, y, x + s, y + s], fill=tuple(r.randint(0, 255) for _ in range(3)))
    d.rectangle(
        [cx - w // 3, cy + h // 2 - 10, cx + w // 3, cy + h // 2 + 20], fill=tuple(max(0, c - 60) for c in main)
    )
    return img


@lru_cache(maxsize=4096)
def product_png(visual_seed: str, variant: int) -> bytes:
    r = random.Random(f"var:{visual_seed}:{variant}")
    img = _base(visual_seed).copy()
    if variant:
        m = int(SIZE * r.uniform(0.0, 0.05))
        img = img.crop((m, m, SIZE - m, SIZE - m)).resize((SIZE, SIZE))
        img = ImageEnhance.Brightness(img).enhance(r.uniform(0.92, 1.08))
        img = ImageEnhance.Color(img).enhance(r.uniform(0.9, 1.1))
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
