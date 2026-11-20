# ADR 0002: Store intelligence (fase 2)

Datum: 2026-11-20 · Status: geaccepteerd

## Pipeline
`crawl_targets` → scheduler (`claim_due`, `FOR UPDATE SKIP LOCKED` + lease) → Celery-taak `crawl_target` → `run_target` → `crawl_store`:

1. Homepage ophalen → `detect()`: platform, metadata en technologieën. Technologieën worden **op naam** gediffd; een herclassificatie (pixel → analytics) is dus geen wijziging.
2. Catalogus ophalen (`products.json`, met de sitemap als terugval) en bestsellers via een collectie.
3. `diff_catalog()` (puur): toegevoegd, verwijderd, prijs, vergelijkprijs, voorraad, varianten en titel.
4. Postgres bevat de **huidige staat**. ClickHouse krijgt **alleen snapshots bij een gewijzigde content-hash**, plus `change_events`. Een tweede crawl zonder wijzigingen schrijft niets (dit wordt getest).
5. Nieuwe producten worden aan bestaande clusters gekoppeld via pg_trgm op een genormaliseerde titel (drempel 0,45). Embeddings volgen in fase 4.

## Planning en betrouwbaarheid
- `compute_schedule()` kent drie ritmes:
  - hot (gevolgd, ≥ 5 wijzigingen per week, of jonger dan 30 dagen): elke 6 uur;
  - normaal: elke 24 uur;
  - slapend: elke 3 dagen.
- De prioriteit volgt watchers, groei en verkeer.
- Fouten: `failures` + exponentiële backoff. Na 5 opeenvolgende fouten volgt een **dead letter**: één herpoging per week, zichtbaar in Admin.
- Retries zitten in de database, niet in Celery. Daardoor overleeft de staat herstarts en is ze zichtbaar in `crawl_jobs`.
- `RedisDomainRateLimiter`: één limiet per domein voor álle workers, op de klok van Redis.
- Freshness: `connectors.last_success_at` gemeten tegen de `freshness_sla_hours` per bron (Admin → "Versheid per databron").

## Discovery
CT-logs (crt.sh), ad-landingspagina's en CSV-import leveren kandidaten → `store_candidates` → probe (homepage + detectie) → `stores`. Een nieuwe Shopify-winkel krijgt meteen een crawl-target met prioriteit 10.

## Mock-modus: het nep-internet
Om de **echte** pipeline zonder externe toegang te kunnen draaien en testen, serveert `trendscope.mockweb` een deterministisch internet via een httpx-transport:

- **Winkels:** de 180 demowinkels uit de seed (de dag-0-staat in `.mockweb/baseline.json`) plus 22 nog onontdekte sites (Shopify, WooCommerce, Magento, BigCommerce, Wix en sites zonder winkel).
- **Gedrag per dag:** nieuwe producten, verwijderingen, prijs- en voorraadwijzigingen. De kans hangt af van het winkeltype.
- **Pagina's:** robots.txt (Shopify-standaard), homepage-HTML met echte kenmerken, `products.json`, `collections.json`, sitemaps en crt.sh-JSON.
- **Afwijkingen:** ~8% van de winkels heeft `products.json` uitgeschakeld en ~30% heeft geen bestseller-collectie, zodat ook de terugvalpaden draaien.

`trendscope simulate --days 14` speelt de afgelopen twee weken af. Zo krijgt de UI een realistische tijdlijn die door de productiecode is gemaakt.

## Bewust (nog) niet
- **Omzet- en verkeersschattingen** van gecrawlde winkels: daarvoor is een clickstream- of panelpartner nodig (bijvoorbeeld de Similarweb-API). Zonder bron tonen we "—" in plaats van een verzonnen getal.
- **Screenshots** van winkels (Playwright → S3): die horen bij het mediabeleid in fase 3. Tot dan tonen we een merk-tegel.
- **B2B-leadsexport:** fase 11.
