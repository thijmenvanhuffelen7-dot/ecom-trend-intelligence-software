"""Perceptual hash (DCT-pHash): dezelfde productfoto herkennen na schalen, comprimeren, lichte crop of filter."""

from __future__ import annotations

import io
from functools import lru_cache

import numpy as np
from PIL import Image

SIZE = 32  # afbeelding wordt verkleind tot 32×32 grijswaarden
LOW = 8  # 8×8 laagfrequente DCT-coëfficiënten → 64 bits


@lru_cache(maxsize=1)
def _dct_matrix(n: int = SIZE) -> np.ndarray:
    k = np.arange(n)[:, None]
    x = np.arange(n)[None, :]
    m = np.cos(np.pi * (2 * x + 1) * k / (2 * n)) * np.sqrt(2 / n)
    m[0] /= np.sqrt(2)
    out: np.ndarray = m
    return out


def phash_image(img: Image.Image) -> int:
    gray = np.asarray(img.convert("L").resize((SIZE, SIZE), Image.Resampling.LANCZOS), dtype=np.float64)
    d = _dct_matrix()
    coeffs = d @ gray @ d.T
    block = coeffs[:LOW, :LOW].flatten()
    median = np.median(block[1:])  # DC-term (gemiddelde helderheid) telt niet mee
    bits = block > median
    value = 0
    for b in bits:
        value = (value << 1) | int(b)
    # naar signed 64-bit, zodat het in een Postgres bigint past
    return value - (1 << 64) if value >= (1 << 63) else value


def phash_bytes(data: bytes) -> int:
    with Image.open(io.BytesIO(data)) as img:
        img.load()
        return phash_image(img)


def hamming(a: int, b: int) -> int:
    return bin((a ^ b) & ((1 << 64) - 1)).count("1")


def image_similarity(a: int | None, b: int | None) -> float | None:
    """1.0 = identiek; < ~0.75 = verschillend beeld. None als een van beide geen hash heeft."""
    if a is None or b is None:
        return None
    return 1 - hamming(a, b) / 64
