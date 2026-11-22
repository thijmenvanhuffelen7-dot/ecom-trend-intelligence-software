# Bron: Reddit Data API

| | |
|---|---|
| Connector-id | `reddit` |
| Type | official_api |
| Juridische status | **pending**. Sinds 2023 vereist commercieel gebruik van de Data API een (betaalde) overeenkomst met Reddit. **Vóór productie een commerciële licentie regelen.** |
| Credentials | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` (script/web-app, client-credentials) |

## Wat we ophalen
1. Token: `POST https://www.reddit.com/api/v1/access_token` (`grant_type=client_credentials`, Basic-auth).
2. `GET https://oauth.reddit.com/search?q="<term>"&sort=new&t=week&limit=100&type=link`, met paginering via `after`.

We slaan alleen op: post-id, subreddit, titel, link, score, aantal reacties en tijdstip. **Geen gebruikersnamen, geen reacties, geen NSFW-posts.**

## Gebruik in Trendscope
- Het **reddit**-signaal per productcluster: vermeldingen per dag (in de groep "vraag").
- Op de keyword-pagina staan de recente posts, zodat je kunt lezen wát mensen zeggen.

## Beperkingen
- De zoekfunctie van Reddit is niet volledig: niet elke vermelding wordt gevonden. Het signaal is daarom vooral bruikbaar als relatieve groei.
- De rate limit is ongeveer 100 verzoeken per minuut per OAuth-client. Wij blijven ruim daaronder (1 per seconde).
