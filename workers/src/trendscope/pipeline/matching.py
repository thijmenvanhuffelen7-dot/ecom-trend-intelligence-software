"""Eenvoudige productmatching op titel (fase 2). Beeld- en tekst-embeddings volgen in fase 4."""

from __future__ import annotations

import re
import unicodedata

# Varianten, marketingwoorden en verpakkingsaanduidingen zeggen niets over wélk product het is
NOISE = {
    "new",
    "pro",
    "max",
    "mini",
    "plus",
    "premium",
    "original",
    "official",
    "bundle",
    "pack",
    "set",
    "limited",
    "edition",
    "sale",
    "hot",
    "best",
    "seller",
    "the",
    "a",
    "an",
    "for",
    "with",
    "and",
    "de",
    "het",
    "een",
    "voor",
    "met",
    "2",
    "3",
    "4",
    "2-pack",
    "3-pack",
    "xl",
    "xxl",
    "2.0",
    "3.0",
    "v2",
}


def normalize_title(title: str) -> str:
    """'Mini Massage Gun — Limited Edition (2-Pack)' → 'massage gun'."""
    t = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    t = re.split(r"\s[—–|]\s|\s-\s", t)[0]  # alles na een scheidingsteken is meestal variant/marketing
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", t)
    words = [
        w for w in re.findall(r"[a-z0-9.\-]+", t) if w not in NOISE and not re.fullmatch(r"\d+(ml|g|cm|pcs|x)?", w)
    ]
    return " ".join(words)


# Drempel voor pg_trgm-similariteit waarboven we een product aan een cluster koppelen
MATCH_THRESHOLD = 0.45

MATCH_SQL = """
SELECT id, similarity(canonical_title, %(t)s) AS score
FROM product_clusters
WHERE canonical_title %% %(t)s  -- pg_trgm is hoofdletterongevoelig en gebruikt de trigram-index
ORDER BY score DESC
LIMIT 1
"""
