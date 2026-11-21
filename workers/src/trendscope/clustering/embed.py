"""Tekstembeddings voor producttitels.

Standaard een deterministische *hashing*-embedder (tekens-n-grammen + woorden → 256 dimensies). Die vangt
typografische varianten ('Posture Corrector' ↔ 'posture-corrector belt') zonder modeldownload en is
reproduceerbaar in tests. Een semantisch model (sentence-transformers/CLIP) kan via `Embedder` worden
ingeplugd; de dimensie staat dan in de migratie.
"""

from __future__ import annotations

import math
import zlib
from typing import Protocol

from trendscope.pipeline.matching import normalize_title

DIM = 256


class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...


def _features(text: str) -> dict[str, float]:
    feats: dict[str, float] = {}
    words = text.split()
    for w in words:
        feats[f"w:{w}"] = feats.get(f"w:{w}", 0) + 1.5
        # meervoud/enkelvoud gelijkstellen
        if len(w) > 3 and w.endswith("s"):
            feats[f"w:{w[:-1]}"] = feats.get(f"w:{w[:-1]}", 0) + 1.0
        padded = f" {w} "
        for i in range(len(padded) - 2):
            g = f"c:{padded[i : i + 3]}"
            feats[g] = feats.get(g, 0) + 1.0
    for a, b in zip(words, words[1:], strict=False):
        feats[f"b:{a}_{b}"] = feats.get(f"b:{a}_{b}", 0) + 1.0
    return feats


class HashingEmbedder:
    def embed(self, text: str) -> list[float]:
        vec = [0.0] * DIM
        for feat, weight in _features(normalize_title(text)).items():
            h = zlib.crc32(feat.encode())
            sign = 1.0 if (h >> 31) & 1 else -1.0
            vec[h % DIM] += sign * (1 + math.log(weight))
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [round(v / norm, 6) for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


def from_pgvector(raw: str | list[float] | None) -> list[float] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    return [float(x) for x in raw.strip("[]").split(",")]


default_embedder = HashingEmbedder()
