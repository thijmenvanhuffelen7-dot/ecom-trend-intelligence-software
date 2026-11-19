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
