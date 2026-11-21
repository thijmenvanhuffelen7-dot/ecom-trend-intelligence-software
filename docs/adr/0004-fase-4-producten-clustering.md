# ADR 0004 — Fase 4: productdatabase, clustering en marktplaatsen

Status: geaccepteerd · 2026-11-20

## Context
Hetzelfde product verschijnt in tientallen winkels, op AliExpress, Amazon en bij CJ onder steeds andere titels en foto's. Pas als die listings één "productcluster" vormen, kunnen we aanbod (winkels, ads), vraag (verkopen, BSR) en economie (inkoop vs. verkoopprijs) op één plek tonen.

## Besluiten
1. **Tekstembedding zonder extern model.** `HashingEmbedder`: 256 dimensies, gesigneerde hashing van woorden, woordparen en karakter-trigrammen op de genormaliseerde titel. Deterministisch, snel en zonder GPU of netwerk. Vervangbaar door een echt model (bv. multilingual-e5) met dezelfde interface. De kolom is `vector(256)` met een HNSW-index (pgvector).
2. **Beeld via pHash.** 64-bit DCT perceptual hash, opgeslagen als signed bigint. Bestand tegen schalen, JPEG-compressie, helderheid en lichte crops (≤ 8 bits verschil in tests). Gelijkenis = 1 − hamming/64.
3. **Score = tekst + beeld.** Tekst = ½·cosinus + ½·containment (zitten de kernwoorden van het cluster in de lange marktplaatstitel?). Met beeld: 0,6·tekst + 0,4·beeld. Elke match bewaart zijn bewijs (`cluster_members.evidence`), dat de UI per listing toont.
4. **Drempels.** Aansluiten bij een bestaand cluster ≥ 0,60; twee losse producten vormen samen een nieuw cluster ≥ 0,62, maar alleen als ze van een verschillende herkomst zijn (andere winkel of verkoper). Samenvoegen gebeurt bij cosinus ≥ 0,93 en containment ≥ 0,8, óf bij beeld ≥ 0,9 en tekst ≥ 0,55.
5. **Samenvoegen is herleidbaar.** `merge_clusters` verplaatst leden, links, leveranciers, watchlists en boarditems en schrijft een rij in `cluster_merges`.
6. **Snelle en grondige route.** Winkelcrawls koppelen nieuwe producten direct op titel-trigram en slaan de embedding op. Wat niet matcht, pakt de clustering-job (Celery beat, :05 en :35) op met tekst + beeld + vectorzoektocht. Marktplaatsingest clustert direct.
7. **Temu afgewezen** (geen officiële API); Amazon via de Creators API omdat PA-API 5 wordt uitgefaseerd.
8. **Geen nepscores.** Nieuwe clusters krijgen geen score tot de scoring-pipeline genoeg signalen heeft; de UI toont "Score volgt" met de ruwe feiten (marktplaatsverkopen, winkels, laagste inkoop).

## Gevolgen
- In de demowereld clustert 100% van de marktplaatslistings bij het juiste product (integratietest).
- HashingEmbedder kent geen synoniemen ("hair clip" ≠ "claw clip"); dat vangt het beeldsignaal deels op. Een echt embeddingmodel is de eerste verbetering zodra GPU of een API beschikbaar is.
