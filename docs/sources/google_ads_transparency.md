# Bron: Google Ads Transparency Center (BigQuery)

| | |
|---|---|
| Connector-id | `google_ads_transparency` |
| Type | official_api (publieke dataset `bigquery-public-data.google_ads_transparency_center.creative_stats`) |
| Juridische status | **pending** (publieke dataset; BigQuery-voorwaarden) |
| Credentials | Google Cloud-project met BigQuery-toegang (`GOOGLE_APPLICATION_CREDENTIALS`) |
| Kosten | BigQuery rekent per gescande byte. Elke query filtert op adverteerder-ID en heeft een harde limiet (`maximum_bytes_billed` = 50 GB). |

## Wat er wél en niet in zit
- **Wel:** adverteerder (ID, naam, locatie, verificatie), creative-ID, formaat, link naar de Transparency-pagina en per regio de eerste/laatste vertoning plus een bandbreedte voor het aantal vertoningen.
- **Niet:** tekst, landingspagina of beeld.
- **Dekking:** alleen adverteerders met ads in de EER of Turkije, en vertoningsdata vanaf 1 maart 2023.

## Gebruik
Volume en looptijd per adverteerder (en dus per winkel). Een rij per (creative, regio) voegen we samen tot één ad. Het EER-totaal tellen we niet dubbel. Bereik = vertoningen ÷ frequentie, met betrouwbaarheid "medium".
