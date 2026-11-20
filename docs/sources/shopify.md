# Bron: Shopify publieke storefront-endpoints

| | |
|---|---|
| Connector-id | `shopify_storefront` |
| Type | scrape_public |
| Juridische status | **pending** — moet door de jurist getoetst worden voordat de connector in productie aan mag |
| Persoonsgegevens | none (alleen productcatalogi van bedrijven) |
| Retentie | 730 dagen |

## Wat we ophalen
`https://<winkel>/products.json?limit=250&page=N`: de publieke productcatalogus die Shopify-winkels standaard aanbieden. Het gaat om titel, handle, prijs, varianten, beschikbaarheid, tags en afbeeldings-URL's.

## Technische afspraken (afgedwongen in `PoliteHttpClient`)
- robots.txt wordt per domein gelezen en gerespecteerd. Een onbereikbare robots.txt betekent: niet crawlen.
- Maximaal 0,5 request per seconde per domein en 50 per seconde globaal.
- User-Agent `TrendscopeBot/x.y (+https://trendscope.example/bot)` met een contactpagina en opt-out.
- Backoff bij 429/5xx met respect voor `Retry-After`. Conditional requests (ETag/Last-Modified).
- Snapshots worden alleen geschreven als de content-hash van prijs, voorraad of varianten wijzigt.
- **Niet:** inloggen, checkout, wachtwoord-beveiligde winkels, CAPTCHA-omzeiling of proxies om blokkades te omzeilen.

## Open vragen voor de jurist
- Valt systematisch ophalen van publieke catalogi onder de Shopify-voorwaarden en de databankenrichtlijn (sui-generisrecht van de winkel)?
- Mogen we productafbeeldingen cachen en tonen, of alleen linken?
- Opt-out-procedure voor winkeleigenaren (verzoek → domein op blokkadelijst).

## Aanvulling fase 2
- **Bestsellers:** Shopify's standaard robots.txt bevat `Disallow: /collections/*sort_by*`, dus `?sort_by=best-selling` gebruiken we **niet**. In plaats daarvan zoeken we in `/collections.json` naar een collectie die de winkel zelf als bestseller markeert (`best-sellers`, `bestsellers`, `top-sellers`, `most-popular`, `trending`) en nemen we de volgorde uit `/collections/<handle>/products.json`. Een integratietest bewaakt dat de crawler nooit om `sort_by` vraagt.
- **Terugvalpad:** heeft een winkel `/products.json` uitgeschakeld (404/401/403), dan lezen we `sitemap.xml` → `sitemap_products_*.xml` en daarna per product `/products/<handle>.json`, met een maximum van 60 per run. Bij een onvolledige catalogus melden we geen "verwijderde" producten.
- **Fixtures:** de testfixtures volgen het gedocumenteerde Shopify-formaat. Echte responses worden pas als fixture vastgelegd na juridisch akkoord.
