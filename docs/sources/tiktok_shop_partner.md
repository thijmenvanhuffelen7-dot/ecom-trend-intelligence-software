# Bron: TikTok Shop en creators (via een datapartner)

| | |
|---|---|
| Connector-id | `tiktok_shop_partner` |
| Type | partner_api |
| Juridische status | **pending, hoog risico**. Alleen inschakelen met een partner die aantoonbaar een licentie heeft (of eigen officiële toegang) voor deze data. Wij scrapen TikTok niet zelf. |
| Credentials | `TIKTOK_PARTNER_BASE_URL`, `TIKTOK_PARTNER_API_KEY` |

## Waarom een partner
TikTok biedt derden geen officiële API voor Shop-verkopen of voor statistieken van andermans creators:
- de **TikTok Shop Partner API** is voor verkopers en hun eigen winkel;
- de **Research API** is alleen voor (academisch) onderzoek;
- de **Display API** geeft alleen data van gebruikers die zelf inloggen.

Scrapen van tiktok.com valt buiten onze uitgangspunten: geen omzeiling van logins of anti-botmaatregelen. Daarom staat deze bron achter een uitschakelbare connector met een eigen, neutraal datacontract. Per partner schrijven we een adapter.

## Datacontract (ons formaat)
- `GET /v1/categories/{niche}/top?country=NL` → topproducten (met `shop_id`) en topcreators: ontdekking
- `GET /v1/shops/{shop_id}` → shop en producten, met de **verkochtteller** zoals TikTok die toont
- `GET /v1/creators/{handle}` → profiel, recente video's (met productanker) en livestreams (met verkochte stuks per product)

## Schattingen
- **Verkopen 30d** = stijging van de verkochtteller over 30 dagen (onze eigen snapshots). **GMV** = verkopen × prijs, met betrouwbaarheid *medium* en een bandbreedte van −20%/+15%, omdat TikTok tellers afrondt.
- **GMV van een creator** = views × CTR (1,5%) × conversie (3%) × prijs, plus verkopen tijdens lives. Betrouwbaarheid *laag*, bandbreedte ×0,4–×2.

## AVG
Alleen publieke profielen. Contact alleen als zakelijk e-mailadres dat de creator zelf publiceert. Geen volgers, reageerders of kijkers, en geen persoonsgegevens van eindklanten.
