# Bron: zoekinteresse (Google Trends via DataForSEO)

| | |
|---|---|
| Connector-id | `dataforseo_trends` |
| Type | partner_api |
| Juridische status | **pending**. DataForSEO is een betaalde datapartner; hun voorwaarden staan doorverkoop van ruwe data niet toe, maar wel afgeleide inzichten (index, groei, fase) in een eigen product. **Toetsen.** |
| Credentials | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (HTTP Basic-auth) |

## Waarom een partner
Google heeft een officiële Google Trends API aangekondigd, maar die is in alpha met beperkte toegang. Tot we die toegang hebben, halen we de Trends-grafiek via DataForSEO (`google_trends/explore/live`). Zodra de officiële API beschikbaar is, kan de connector worden vervangen zonder de rest te raken: de opslag (`keyword_signals_daily`) blijft gelijk.

## Wat we ophalen
`POST https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live` met per aanvraag **één** keyword, een land (`location_name`) en een venster van 2 jaar.

- Google normaliseert binnen één aanvraag naar max = 100. Eén keyword per aanvraag houdt elke reeks op zijn eigen schaal.
- Elke aanvraag overschrijft het hele venster (ReplacingMergeTree op `updated_at`), dus er ontstaan geen naden tussen dagen.
- Bij lange vensters levert Google wekelijkse punten. Die vullen we per dag op met de laatst bekende waarde.

## Gebruik in Trendscope
- Keywordfase, groei (7/30/90 dagen), seizoenspiek (alleen als het maandprofiel van twee opeenvolgende jaren overeenkomt) en een forecast van 90 dagen.
- Het **search**-signaal van een productcluster is de som van de interesse van gekoppelde zoektermen in de hoofdmarkt (`TREND_COUNTRY`, standaard NL).

## Beperkingen
- De index is relatief (0–100 per venster), geen aantal zoekopdrachten. Absolute volumes (Google Ads Keyword Planner via DataForSEO) zijn een mogelijke uitbreiding.
- Kosten schalen met het aantal keywords × landen × de crawlfrequentie.
