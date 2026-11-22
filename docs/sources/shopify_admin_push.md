# Integratie: Shopify Admin API (push-to-store)

| | |
|---|---|
| Richting | Uitgaand: wij schrijven naar de **eigen** winkel van de gebruiker, op diens verzoek |
| Type | official_api (GraphQL Admin API, versie `2025-10`) |
| Juridische status | **approved**. De gebruiker koppelt zelf een custom app in zijn eigen winkel met scope `write_products`. |
| Credentials | Per workspace: shopdomein + Admin API access token (`shpat_…`), versleuteld met AES-256-GCM (`APP_ENCRYPTION_KEY`) |

## Wat we doen
1. Bij het koppelen: `{ shop { name } }`. Zo valt een verkeerd token direct op.
2. Bij een push: `productCreate` met `status: DRAFT`, titel, beschrijving (HTML uit platte tekst, ge-escapet), producttype (niche) en de tags `trendscope` en `trendscope-<id>`. Daarna `productVariantsBulkUpdate` om de prijs op de standaardvariant te zetten.
3. Elke push wordt gelogd in `store_pushes`, met de status en de link naar de Shopify-admin.

## Wat we bewust niet doen
- **Geen afbeeldingen of teksten van andere winkels kopiëren.** Productfoto's en beschrijvingen van concurrenten zijn auteursrechtelijk beschermd. De beschrijving komt uit onze eigen AI-ad-copy of van de gebruiker; foto's voegt de gebruiker zelf toe (bv. van de leverancier, met toestemming).
- Niets publiceren: een concept is niet zichtbaar voor klanten.
- Geen andere scopes vragen dan `write_products`.

## Mock-modus
Met `DATA_MODE=mock` (de standaard lokaal en in CI) praten we niet met Shopify: koppelen en pushen worden gesimuleerd. In de UI staat dan het label "Demo-koppeling".

## Beperkingen
- Nu alleen Shopify via een custom app (token). Een publieke Shopify-app met OAuth en WooCommerce volgen later.
- Varianten (maten en kleuren) zetten we niet over; we maken één standaardvariant met de gekozen prijs.
