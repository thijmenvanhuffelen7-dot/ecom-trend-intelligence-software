"""Productclustering: hetzelfde product herkennen over winkels en marktplaatsen heen.

Per product:
1. kandidaat-clusters ophalen via pgvector (dichtstbijzijnde centroids);
2. score = tekst (embedding + token-containment) en, waar beide een afbeelding hebben, beeld (pHash);
3. boven de drempel → lid van het cluster (met bewijs); anders blijft het product in de 'pool'.
Uit de pool ontstaan nieuwe clusters zodra ≥ 2 producten van verschillende bronnen/winkels elkaar
sterk genoeg matchen. Daarna worden bijna-identieke clusters samengevoegd (met audit-spoor).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from trendscope.clustering.embed import cosine, default_embedder, from_pgvector, to_pgvector
from trendscope.clustering.phash import image_similarity
from trendscope.pipeline.matching import normalize_title

JOIN_THRESHOLD = 0.6  # product → bestaand cluster
POOL_THRESHOLD = 0.62  # twee ongeclusterde producten → nieuw cluster
MERGE_COSINE = 0.93  # clusters samenvoegen
MERGE_CONTAINMENT = 0.8
MERGE_IMAGE = 0.9  # pHash: hooguit 6 van 64 bits verschillend
MERGE_TEXT_WITH_IMAGE = 0.55
CANDIDATES = 5


def tokens(title: str) -> set[str]:
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in normalize_title(title).split() if len(w) > 1}


def containment(core: str, other: str) -> float:
    """Welk deel van de kernwoorden van `core` (bv. clustertitel) komt voor in `other` (bv. lange listingtitel)."""
    a, b = tokens(core), tokens(other)
    return len(a & b) / len(a) if a else 0.0


@dataclass
class Match:
    cluster_id: int
    score: float
    evidence: dict[str, float | None]


def score_pair(
    title_a: str,
    emb_a: list[float],
    img_a: int | None,
    title_b: str,
    emb_b: list[float],
    img_b: int | None,
    *,
    symmetric: bool = False,
) -> tuple[float, dict[str, float | None]]:
    cos = cosine(emb_a, emb_b)
    contain = (
        min(containment(title_a, title_b), containment(title_b, title_a))
        if symmetric
        else containment(title_b, title_a)
    )  # b = cluster/kern, a = kandidaat
    text = 0.5 * max(cos, 0) + 0.5 * contain
    image = image_similarity(img_a, img_b)
    total = 0.6 * text + 0.4 * image if image is not None else text
    return total, {
        "text": round(text, 3),
        "cosine": round(cos, 3),
        "containment": round(contain, 3),
        "image": round(image, 3) if image is not None else None,
    }


@dataclass
class ClusterStats:
    embedded: int = 0
    joined: int = 0
    new_clusters: int = 0
    merged: int = 0
    unclustered: int = 0
    touched: set[int] = field(default_factory=set)

    def as_dict(self) -> dict[str, int]:
        return {
            "embedded": self.embedded,
            "joined": self.joined,
            "new_clusters": self.new_clusters,
            "merged": self.merged,
            "unclustered": self.unclustered,
            "touched": len(self.touched),
        }


def ensure_embeddings(conn: psycopg.Connection[Any], *, limit: int = 20_000) -> int:
    """Embeddings voor producten en clusters die er nog geen hebben."""
    n = 0
    with conn.cursor() as cur:
        cur.execute("SELECT id, title FROM products WHERE embedding IS NULL LIMIT %s", (limit,))
        rows = cur.fetchall()
        for pid, title in rows:
            cur.execute(
                "UPDATE products SET embedding = %s WHERE id = %s", (to_pgvector(default_embedder.embed(title)), pid)
            )
        n += len(rows)
        cur.execute("SELECT id, canonical_title FROM product_clusters WHERE embedding IS NULL")
        for cid, title in cur.fetchall():
            cur.execute(
                "UPDATE product_clusters SET embedding = %s WHERE id = %s",
                (to_pgvector(default_embedder.embed(title)), cid),
            )
    conn.commit()
    return n


def _best_cluster(cur: psycopg.Cursor[Any], product: dict[str, Any]) -> Match | None:
    cur.execute(
        """SELECT id, canonical_title, embedding::text AS emb, image_phash FROM product_clusters
           WHERE embedding IS NOT NULL ORDER BY embedding <=> %s::vector LIMIT %s""",
        (product["emb_text"], CANDIDATES),
    )
    best: Match | None = None
    emb = from_pgvector(product["emb_text"])
    assert emb is not None
    for c in cur.fetchall():
        score, ev = score_pair(
            product["title"],
            emb,
            product["image_phash"],
            c["canonical_title"],
            from_pgvector(c["emb"]) or emb,
            c["image_phash"],
        )
        if best is None or score > best.score:
            best = Match(int(c["id"]), score, ev)
    return best


def _method(ev: dict[str, float | None]) -> str:
    return "combined" if ev.get("image") is not None else "embedding"


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def _canonical_title(titles: list[str]) -> str:
    """Kortste titel die de gedeelde kernwoorden bevat, opgeschoond en in Title Case."""
    shared = set.intersection(*(tokens(t) for t in titles)) if titles else set()
    words = [
        w
        for w in normalize_title(min(titles, key=len)).split()
        if not shared or w.rstrip("s") in {s.rstrip("s") for s in shared}
    ]
    title = " ".join(words[:6]) or normalize_title(titles[0])
    return title.title()


def cluster_products(
    conn: psycopg.Connection[Any], *, now: datetime, limit: int = 5_000, product_ids: list[int] | None = None
) -> ClusterStats:
    stats = ClusterStats()
    stats.embedded = ensure_embeddings(conn)
    with conn.transaction(), conn.cursor(row_factory=dict_row) as cur:
        where = "p.id = ANY(%(ids)s)" if product_ids else "p.clustered_at IS NULL"
        cur.execute(
            f"""SELECT p.id, p.title, p.embedding::text AS emb_text, p.image_phash, p.source::text AS source, p.store_id,
                       p.seller_id, m.cluster_id
                FROM products p LEFT JOIN cluster_members m ON m.product_id = p.id
                WHERE {where} AND p.status <> 'removed' AND p.embedding IS NOT NULL
                ORDER BY p.id LIMIT %(limit)s""",
            {"ids": product_ids, "limit": limit},
        )
        products = cur.fetchall()
        pool: list[dict[str, Any]] = []
        for p in products:
            if p["cluster_id"]:
                stats.touched.add(
                    int(p["cluster_id"])
                )  # al lid (bv. via titelmatch bij het crawlen): centroid bijwerken
                continue
            match = _best_cluster(cur, p)
            if match and match.score >= JOIN_THRESHOLD:
                cur.execute(
                    """INSERT INTO cluster_members (cluster_id, product_id, confidence, method, evidence)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                    (match.cluster_id, p["id"], round(match.score, 3), _method(match.evidence), Jsonb(match.evidence)),
                )
                stats.joined += 1
                stats.touched.add(match.cluster_id)
            else:
                pool.append(p)

        if pool:
            # Wezen van eerdere rondes (nog zonder cluster) doen mee: een tweede bron kan nu wél matchen.
            # Per kandidaat de dichtstbijzijnde wezen via de vectorindex, zodat de pool klein blijft.
            seen = {p["id"] for p in products}
            for p in list(pool):
                cur.execute(
                    """SELECT p.id, p.title, p.embedding::text AS emb_text, p.image_phash, p.source::text AS source,
                              p.store_id, p.seller_id
                       FROM products p
                       WHERE p.embedding IS NOT NULL AND p.clustered_at IS NOT NULL AND p.status <> 'removed'
                         AND NOT EXISTS (SELECT 1 FROM cluster_members m WHERE m.product_id = p.id)
                       ORDER BY p.embedding <=> %s::vector LIMIT %s""",
                    (p["emb_text"], CANDIDATES),
                )
                for o in cur.fetchall():
                    if o["id"] not in seen:
                        seen.add(o["id"])
                        pool.append(o)
        stats.new_clusters = _cluster_pool(cur, pool, now, stats)
        stats.unclustered = sum(1 for p in pool if not p.get("_clustered"))
        if products:
            cur.execute("UPDATE products SET clustered_at = %s WHERE id = ANY(%s)", (now, [p["id"] for p in products]))
        for cid in sorted(stats.touched):
            refresh_cluster(cur, cid)
        stats.merged = _merge_near_duplicates(cur, sorted(stats.touched), now)
    return stats


def _cluster_pool(cur: psycopg.Cursor[Any], pool: list[dict[str, Any]], now: datetime, stats: ClusterStats) -> int:
    """Greedy: start bij elk ongeclusterd product, verzamel sterke matches van andere bronnen/winkels."""
    for p in pool:
        p["_emb"] = from_pgvector(p["emb_text"])
        # Eén 'herkomst' per winkel of per marktplaatsverkoper: twee listings van dezelfde verkoper bewijzen niets
        p["_origin"] = f"{p['source']}:{p['store_id'] or p.get('seller_id') or p['id']}"
    created = 0
    used: set[int] = set()
    for i, seed in enumerate(pool):
        if seed["id"] in used:
            continue
        group = [seed]
        for other in pool[i + 1 :]:
            if other["id"] in used or other["_origin"] in {g["_origin"] for g in group}:
                continue
            score, _ = score_pair(
                other["title"],
                other["_emb"],
                other["image_phash"],
                seed["title"],
                seed["_emb"],
                seed["image_phash"],
                symmetric=True,
            )
            if score >= POOL_THRESHOLD:
                group.append(other)
        if len(group) < 2:
            continue
        title = _canonical_title([g["title"] for g in group])
        cur.execute(
            """INSERT INTO product_clusters (canonical_title, slug, category, keywords, first_seen, created_by, niche_id)
               VALUES (%s, %s || '-' || substr(md5(random()::text), 1, 6), NULL, %s, %s, 'clustering',
                       (SELECT s.niche_id FROM stores s WHERE s.id = ANY(%s) AND s.niche_id IS NOT NULL LIMIT 1))
               RETURNING id""",
            (title, _slugify(title), sorted(tokens(title))[:5], now, [g["store_id"] for g in group if g["store_id"]]),
        )
        row = cur.fetchone()
        assert row is not None
        cid = int(row["id"])
        for g in group:
            score, ev = score_pair(
                g["title"],
                g["_emb"],
                g["image_phash"],
                seed["title"],
                seed["_emb"],
                seed["image_phash"],
                symmetric=True,
            )
            cur.execute(
                "INSERT INTO cluster_members (cluster_id, product_id, confidence, method, evidence) VALUES (%s, %s, %s, %s, %s)",
                (cid, g["id"], round(1.0 if g is seed else score, 3), _method(ev), Jsonb(ev)),
            )
            g["_clustered"] = True
            used.add(g["id"])
        stats.touched.add(cid)
        created += 1
    return created


def refresh_cluster(cur: psycopg.Cursor[Any], cluster_id: int) -> None:
    """Centroid, representatieve afbeelding en aggregaten opnieuw berekenen."""
    with cur.connection.cursor(row_factory=dict_row) as dcur:
        _refresh_cluster(dcur, cluster_id)


def _refresh_cluster(cur: psycopg.Cursor[Any], cluster_id: int) -> None:
    cur.execute(
        """SELECT p.embedding::text AS emb, p.image_phash, p.source::text AS source, p.store_id, p.price, p.orders_30d, p.images
           FROM cluster_members m JOIN products p ON p.id = m.product_id
           WHERE m.cluster_id = %s AND p.status <> 'removed'""",
        (cluster_id,),
    )
    members = cur.fetchall()
    if not members:
        return
    vecs = [from_pgvector(m["emb"]) for m in members if m["emb"]]
    centroid = None
    if vecs:
        summed = [sum(col) for col in zip(*vecs, strict=True)]
        norm = sum(v * v for v in summed) ** 0.5 or 1.0
        centroid = to_pgvector([v / norm for v in summed])
    phashes = Counter(m["image_phash"] for m in members if m["image_phash"] is not None)
    shop_prices = [float(m["price"]) for m in members if m["store_id"] and m["price"] is not None]
    marketplace_image = next((m["images"][0] for m in members if not m["store_id"] and m["images"]), None)
    cur.execute(
        """UPDATE product_clusters SET
             embedding = COALESCE(%(emb)s::vector, embedding),
             image_phash = COALESCE(%(phash)s, image_phash),
             image_url = COALESCE(image_url, %(img)s),
             source_count = %(sources)s,
             marketplace_orders_30d = %(orders)s,
             store_count = (SELECT count(DISTINCT p.store_id) FROM cluster_members m JOIN products p ON p.id = m.product_id
                            WHERE m.cluster_id = %(id)s AND p.status <> 'removed'),
             min_price = COALESCE(%(min)s, min_price),
             max_price = COALESCE(%(max)s, max_price),
             min_supplier_cost = (SELECT min(price + shipping_cost) FROM supplier_offers WHERE cluster_id = %(id)s)
           WHERE id = %(id)s""",
        {
            "id": cluster_id,
            "emb": centroid,
            "phash": phashes.most_common(1)[0][0] if phashes else None,
            "img": marketplace_image,
            "sources": len({m["source"] for m in members}),
            "orders": sum(int(m["orders_30d"] or 0) for m in members),
            "min": min(shop_prices) if shop_prices else None,
            "max": max(shop_prices) if shop_prices else None,
        },
    )


def _merge_near_duplicates(cur: psycopg.Cursor[Any], cluster_ids: list[int], now: datetime) -> int:
    """Twee clusters zijn hetzelfde product als de titels vrijwel gelijk zijn, óf als het beeld vrijwel gelijk is
    en de titels redelijk overlappen (bv. 'Brow Lamination Kit' en 'Brow Lamination Rechargeable')."""
    merged = 0
    gone: set[int] = set()
    for cid in cluster_ids:
        if cid in gone:
            continue
        cur.execute(
            """SELECT b.id, b.canonical_title, 1 - (a.embedding <=> b.embedding) AS cos, a.canonical_title AS a_title,
                      a.image_phash AS a_img, b.image_phash AS b_img,
                      (SELECT count(*) FROM cluster_members WHERE cluster_id = a.id) AS a_n,
                      (SELECT count(*) FROM cluster_members WHERE cluster_id = b.id) AS b_n
               FROM product_clusters a JOIN product_clusters b ON b.id <> a.id
               WHERE a.id = %s AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
               ORDER BY a.embedding <=> b.embedding LIMIT 3""",
            (cid,),
        )
        for row in cur.fetchall():
            if row["id"] in gone:
                continue
            ab, ba = (
                containment(row["a_title"], row["canonical_title"]),
                containment(row["canonical_title"], row["a_title"]),
            )
            cos = float(row["cos"])
            image = image_similarity(row["a_img"], row["b_img"])
            by_text = cos >= MERGE_COSINE and min(ab, ba) >= MERGE_CONTAINMENT
            by_image = (
                image is not None and image >= MERGE_IMAGE and 0.5 * cos + 0.5 * max(ab, ba) >= MERGE_TEXT_WITH_IMAGE
            )
            if not (by_text or by_image):
                continue
            keep, drop = (cid, int(row["id"])) if row["a_n"] >= row["b_n"] else (int(row["id"]), cid)
            evidence = {"cosine": round(cos, 3), "containment": round(max(ab, ba), 3), "image": image}
            merge_clusters(cur, drop, keep, score=cos, evidence=evidence, now=now)
            gone.add(drop)
            merged += 1
            if drop == cid:
                break
    return merged


def merge_clusters(
    cur: psycopg.Cursor[Any], drop: int, keep: int, *, score: float, evidence: dict[str, Any], now: datetime
) -> None:
    """Alles van `drop` naar `keep` verplaatsen (leden, koppelingen, leveranciers, watchlists, boards)."""
    cur.execute("UPDATE cluster_members SET cluster_id = %s WHERE cluster_id = %s", (keep, drop))
    cur.execute(
        """INSERT INTO entity_links (from_type, from_id, to_type, to_id, link_type, confidence, evidence, first_seen, last_seen)
           SELECT from_type, from_id, to_type, %(keep)s, link_type, confidence, evidence, first_seen, last_seen
           FROM entity_links WHERE to_type = 'product_cluster' AND to_id = %(drop)s
           ON CONFLICT (from_type, from_id, to_type, to_id, link_type) DO NOTHING""",
        {"keep": keep, "drop": drop},
    )
    cur.execute("DELETE FROM entity_links WHERE to_type = 'product_cluster' AND to_id = %s", (drop,))
    cur.execute("UPDATE supplier_offers SET cluster_id = %s WHERE cluster_id = %s", (keep, drop))
    cur.execute(
        """UPDATE watchlists w SET entity_id = %(keep)s WHERE entity_type = 'product_cluster' AND entity_id = %(drop)s
           AND NOT EXISTS (SELECT 1 FROM watchlists x WHERE x.workspace_id = w.workspace_id AND x.entity_type = 'product_cluster' AND x.entity_id = %(keep)s)""",
        {"keep": keep, "drop": drop},
    )
    cur.execute(
        """UPDATE board_items b SET entity_id = %(keep)s WHERE entity_type = 'product_cluster' AND entity_id = %(drop)s
           AND NOT EXISTS (SELECT 1 FROM board_items x WHERE x.board_id = b.board_id AND x.entity_type = 'product_cluster' AND x.entity_id = %(keep)s)""",
        {"keep": keep, "drop": drop},
    )
    # wat niet verplaatst kon worden (stond al op het behouden cluster) is dubbel: opruimen
    cur.execute("DELETE FROM watchlists WHERE entity_type = 'product_cluster' AND entity_id = %s", (drop,))
    cur.execute("DELETE FROM board_items WHERE entity_type = 'product_cluster' AND entity_id = %s", (drop,))
    cur.execute("DELETE FROM scores WHERE entity_type = 'product_cluster' AND entity_id = %s", (drop,))
    cur.execute(
        "INSERT INTO cluster_merges (from_cluster, into_cluster, score, evidence, merged_at) VALUES (%s, %s, %s, %s, %s)",
        (drop, keep, score, Jsonb(evidence), now),
    )
    cur.execute("DELETE FROM product_clusters WHERE id = %s", (drop,))
    refresh_cluster(cur, keep)
