# Bron: Amazon Creators API (opvolger van PA-API 5)

| | |
|---|---|
| Connector-id | `amazon_creators` (manifest `mp_amazon`) |
| Type | official_api |
| Juridische status | **pending**. Toegang via het Amazon Associates-programma; de voorwaarden eisen o.a. affiliatelinks en beperken caching van prijzen. **Toetsen of BSR-schattingen tonen past binnen de licentie.** |
| Credentials | `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET`, `AMAZON_PARTNER_TAG`; marktplaats via `AMAZON_MARKETPLACE` (standaard `www.amazon.de`) |

## Waarom niet PA-API 5
Amazon faseert de Product Advertising API 5.0 uit ten gunste van de Creators API ([migratiegids](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/migrating-to-creatorsapi-from-paapi), [aankondiging](https://paapiplugin.com/amazon-is-retiring-pa-api-v5-is-your-affiliate-plugin-ready/)). We bouwen daarom direct op de Creators API.

## Wat we ophalen
1. Token: OAuth client-credentials (`scope=creatorsapi::default`) bij het regionale tokenendpoint (EU: `api.amazon.co.uk`).
2. `POST https://creatorsapi.amazon/catalog/v1/searchItems` met `keywords`, `partnerTag`, `resources` en header `x-marketplace` ([SearchItems](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items), [curl-voorbeeld](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl)).

Velden: ASIN, titel, merk, afbeelding, prijs (`offersV2`), `browseNodeInfo.websiteSalesRank` (Best Sellers Rank + categorie, [BrowseNodeInfo](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/browse-node-info)).

## Schatting maandverkopen
Uit de BSR schatten we de maandverkopen met een machtsfunctie per hoofdcategorie (`a · rank^-b`). Dit is altijd een **schatting** met betrouwbaarheid *laag* en een bandbreedte van ×0,5 tot ×2; de UI toont dat zo.

## Onzeker
De exacte JSON-structuur van de Creators API konden we nog niet tegen een echt account verifiëren. De parser is daarom tolerant (`searchResult.items` en `itemsResult.items`, camelCase-paden) en heeft unit-tests op de verwachte vorm. **Eerste actie met echte keys: één echte respons opslaan als fixture en de parser daarop testen.**
