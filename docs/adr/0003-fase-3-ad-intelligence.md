# ADR 0003: Ad intelligence (fase 3)

Datum: 2026-11-21 · Status: geaccepteerd

## Bronnen en hun grenzen
Alleen **officiële** bronnen: de Meta Ad Library API, de TikTok Commercial Content API en Google's Transparency-dataset in BigQuery. Geen van drieën levert alles; zie `docs/sources/`. Daarom slaan we één genormaliseerd `AdRecord` op en tonen we per veld welke bron het leverde.

## Pipeline
Per target (`page:<id>`, `biz:<id>`, `adv:<id>` om te volgen; `q:<term>` om te ontdekken) verloopt een run zo:

1. Ophalen (incrementeel: `last_run − 2 dagen`).
2. `ingest_ads`:
   - upsert;
   - events `ad_started`, `ad_stopped`, `advertiser_new` en `ad_scaling`;
   - snapshot in ClickHouse alleen bij een gewijzigde content-hash.
3. **Varianten:** dezelfde genormaliseerde tekst + titel (`creative_hash`). "Schalend" betekent dat een creative er ≥ 2 actieve varianten bij krijgt.
4. **Koppeling:**
   - ad → winkel via het landingsdomein, met TikTok/Google als terugval op naam;
   - ad → product via `/products/<handle>` op de landingspagina (betrouwbaarheid 0,95), anders via de tekst (pg_trgm ≥ 0,5; 0,7);
   - onbekende domeinen worden discovery-kandidaten (`ads_landing`).
5. Schattingen (`ads/estimates.py`), altijd met bandbreedte, betrouwbaarheid en methode.
6. Nieuwe adverteerders uit zoektermen krijgen een eigen volg-target.

Store- en ad-events komen samen in de winkeltijdlijn.

## Performance
- Koppelen en schatten gebeurt alleen voor nieuwe of gewijzigde ads.
- Manifests worden één keer per proces geladen. Dat scheelde ~20 ms per crawl, ook in productie.
- Clustertellingen worden in vaste volgorde bijgewerkt, zodat parallelle workers niet in een deadlock raken.

## Media
- `creative_assets` + S3 met content-addressed sleutels (`<prefix>/<sha[:2]>/<sha>.<ext>`).
- Geen SVG: opgeslagen SVG kan script bevatten.
- `/api/media/...` serveert alleen aan ingelogde gebruikers en alleen sleutels in dat exacte formaat.
- **Winkelscreenshots:** Playwright → PNG → S3, met respect voor robots.txt.
- **Meta-snapshot-capture staat uit** tot er juridisch akkoord is.

## Swipe-file
`boards` + `board_items` per workspace (RLS als vangnet). Elke actie controleert het eigenaarschap. Notities en tags per item.

## Lokale S3
Docker Hub publiceert geen MinIO-images meer; compose gebruikt `quay.io/minio/minio`. Tests draaien tegen elke S3-compatibele server (lokaal/CI: moto). MinIO draait lokaal op poort **9002**, omdat 9000 die van ClickHouse is.
