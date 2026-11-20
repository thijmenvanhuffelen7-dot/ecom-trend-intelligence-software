# Bron: Meta Ad Library API

| | |
|---|---|
| Connector-id | `meta_ad_library` |
| Type | official_api (Graph API `ads_archive`) |
| Juridische status | **pending** |
| Credentials | `META_AD_LIBRARY_ACCESS_TOKEN`: vereist een geverifieerd Meta-account (identiteitscontrole) en akkoord met de Ad Library API-voorwaarden |
| Persoonsgegevens | none: pagina's van adverteerders zijn zakelijk. Doelgroepdata zijn geaggregeerd (leeftijd/geslacht/land). |
| Retentie | 730 dagen |

## Wat we ophalen
`GET https://graph.facebook.com/<versie>/ads_archive` met `ad_reached_countries` (verplicht, EU-landen), `search_page_ids` (gevolgde adverteerders) of `search_terms` (nieuwe adverteerders vinden), en `ad_delivery_date_min` (incrementeel, 2 dagen overlap).

Velden: tekst, titel, link-caption/-beschrijving, start- en stopdatum, plaatsingen, talen, `eu_total_reach`, doelgroepleeftijd/-geslacht, bereik per land en begunstigde/betaler.

## Belangrijke beperkingen
- **Commerciële ads alleen met EU-levering** (DSA). Ads die alleen buiten de EU draaien, staan er niet in.
- **Geen media en geen landingspagina-URL.** Het domein halen we uit `ad_creative_link_captions`. Beeld en video zitten alleen in de *snapshot* (`ad_snapshot_url`, een JavaScript-pagina die het access token vereist).
- **Snapshot-capture staat standaard UIT** (`META_SNAPSHOT_CAPTURE=false`). Het kopiëren van creatives van derden vraagt een eigen juridische toets (auteursrecht, Meta-voorwaarden). Na akkoord renderen we de snapshot met Playwright en slaan we media content-addressed op in S3, alleen zichtbaar voor ingelogde gebruikers.
- **Het access token wordt nooit opgeslagen of gelogd:** `strip_token()` haalt het uit snapshot-URL's, en `redact()` haalt het uit alle foutmeldingen. Beide zijn getest.

## Schattingen
Bereik is exact waar `eu_total_reach` bestaat (betrouwbaarheid "high"). Spend is een afgeleide schatting: bereik × frequentie (1,4–2,6) × CPM-band per landengroep, met betrouwbaarheid "medium". De UI toont altijd de bandbreedte en de methode.
