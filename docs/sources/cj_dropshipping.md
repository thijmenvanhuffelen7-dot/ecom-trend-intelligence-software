# Bron: CJ Dropshipping API v2

| | |
|---|---|
| Connector-id | `cj_dropshipping` (manifest `mp_cj`) |
| Type | official_api |
| Juridische status | **pending**. De API is bedoeld voor CJ-klanten die producten importeren en bestellen; prijzen gebruiken als leveranciersvergelijking ligt in lijn met dat doel, maar moet nog getoetst worden. |
| Credentials | `CJ_API_KEY` (in het CJ-account onder API) |

## Wat we ophalen
Basis: `https://developers.cjdropshipping.com/api2.0/v1`
1. `POST /authentication/getAccessToken` met `{"apiKey": ...}` → access token (header `CJ-Access-Token`).
2. `GET /product/list?productNameEn=…` → producten (id, naam, afbeelding, verkoopprijs, categorie).
3. `POST /logistic/freightCalculate` per product → verzendopties naar het doelland; we nemen de goedkoopste (prijs + levertijd).

## Gebruik in Trendscope
CJ is een leverancier: elke listing wordt een `supplier_offer` met verzendkosten en levertijd, naast AliExpress in de leveranciersvinder. CJ geeft geen verkoopvolumes.

## Beperkingen
Het token is beperkt geldig en het aantal tokenaanvragen per dag is gelimiteerd. In productie moet het token in Redis gecachet worden (nu per run opgehaald).
