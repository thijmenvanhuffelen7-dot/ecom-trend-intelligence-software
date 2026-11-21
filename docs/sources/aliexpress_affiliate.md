# Bron: AliExpress Affiliate API (Open Platform)

| | |
|---|---|
| Connector-id | `aliexpress_affiliate` (manifest `mp_aliexpress`) |
| Type | official_api |
| Juridische status | **pending**. De API is bedoeld voor affiliates die producten promoten. Gebruik als marktonderzoeksbron (verkoopvolumes tonen) moet getoetst worden aan de affiliatevoorwaarden. |
| Credentials | `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` (aan te vragen via het AliExpress Open Platform / Portals-affiliateprogramma) |

## Wat we ophalen
`GET https://api-sg.aliexpress.com/sync` met `method=aliexpress.affiliate.product.query`, `keywords`, `ship_to_country`, `target_currency`, `target_language`, `sort=LAST_VOLUME_DESC`.

Elke aanvraag is ondertekend: HMAC-SHA256 over alle parameters, alfabetisch gesorteerd en als `sleutelwaarde` aan elkaar geplakt, met het app secret als sleutel; de uitkomst gaat in hoofdletters-hex mee als `sign` (`sign_method=sha256`). Het secret zelf gaat nooit over de lijn (er is een test die dat controleert).

Velden: product-id, titel, prijs (actie- en originele prijs), hoofdafbeelding, `lastest_volume` (verkocht in de laatste 30 dagen; de typfout staat zo in de API), `evaluate_rate` (positieve beoordelingen, %), winkel-id/-url, categorieën, `ship_to_days`.

## Gebruik in Trendscope
- Listing → `products` (zonder winkel; uniek op bron + extern id), plus een prijs-snapshot bij elke wijziging.
- De winkel wordt een `supplier`, de listing een `supplier_offer` → leveranciersvinder en minimale inkoopprijs per cluster.
- Afbeelding → pHash voor beeldmatching (en in mock-modus een kopie in S3).

## Beperkingen
- Verkoopvolume is een afgerond getal van AliExpress zelf, geen schatting van ons.
- Verzendkosten komen niet altijd mee; die tonen we dan als "gratis verzending" wanneer AliExpress 0 meldt.

Bronnen: [Node.js-uitleg AliExpress Affiliates (signing)](https://www.oriollopez.com/posts/how-to-use-aliexpress-affiliates-with-nodejs/), [AliExpress Affiliate API-overzicht](https://anythingmcp.com/guides/aliexpress-affiliate-to-mcp). De officiële docs op het Open Platform vereisen een account; de veldnamen zijn daar te verifiëren zodra de keys er zijn.
