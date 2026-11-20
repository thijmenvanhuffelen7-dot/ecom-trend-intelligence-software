# Bron: winkelherkenning (homepage-probe)

| | |
|---|---|
| Connector-id | `store_probe` |
| Type | scrape_public |
| Juridische status | **pending** |
| Persoonsgegevens | none |

## Wat we doen
We halen per kandidaat-domein **één keer** de publieke homepage op, met robots.txt, rate limits en een identificeerbare User-Agent. Daaruit lezen we:

- **Platform:** Shopify (`cdn.shopify.com`, `Shopify.theme`, `x-shopid`), WooCommerce, Magento, BigCommerce of Wix.
- **Winkelgegevens:** naam (`og:site_name`), taal (`<html lang>`, `hreflang`), valuta/land/thema (Shopify-variabelen) en social-links.
- **Technologieën** via script-URL's die de leverancier zelf in de pagina zet: pixels (Meta, TikTok, Google, Pinterest, Snap, …), e-mail (Klaviyo, …), reviews (Judge.me, Loox, …), apps en betaalmethoden (Shopify-betaalicoontjes `pi-<naam>`).

De regels staan in `workers/src/trendscope/detect/signatures.py`. Elke detectie bewaart bewijs (`platform_evidence`).

## Niet
We voeren geen JavaScript uit, loggen niet in, doen geen formulierverzendingen en omzeilen geen CAPTCHA's of wachtwoordpagina's.
