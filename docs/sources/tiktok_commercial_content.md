# Bron: TikTok Commercial Content API

| | |
|---|---|
| Connector-id | `tiktok_commercial_content` |
| Type | official_api |
| Juridische status | **pending**. Toegang wordt per aanvraag verleend; de voorwaarden beperken het gebruik mogelijk tot onderzoek. **Commercieel gebruik moet expliciet getoetst worden.** |
| Credentials | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (client-credentials-token, 2 uur geldig) |

## Wat we ophalen
`POST https://open.tiktokapis.com/v2/research/adlib/ad/query/` met `filters.ad_published_date_range`, `filters.country_code`, en optioneel `advertiser_business_ids` of `search_term`. Paginering loopt via `search_id`/`has_more`.

Velden: id, eerste en laatste vertoning, status, video's (URL + cover), afbeeldingen, bereik (bandbreedte) en adverteerder (business id, naam, betaler).

## Koppeling
TikTok levert geen landingspagina. De adverteerder koppelen we aan een winkel op naam (trigram ≥ 0,8, bewust streng). Ads zonder tekst koppelen we niet aan producten.

## Media
De video-URL's zijn tijdelijk. Na juridisch akkoord kopiëren we ze naar S3 (`creatives/<sha256>`); tot die tijd tonen we alleen de cover-URL.
