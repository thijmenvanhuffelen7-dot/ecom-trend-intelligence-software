# Bron: Instagram Graph API — Business Discovery

| | |
|---|---|
| Connector-id | `instagram_business` |
| Type | official_api |
| Juridische status | **pending**. Vereist een eigen Instagram Business-account, gekoppeld aan een Facebook-pagina en een Meta-app met de juiste permissies (app review). |
| Credentials | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` (het eigen IG-account) |

## Wat we ophalen
`GET /{ig-user-id}?fields=business_discovery.username(<handle>){followers_count,media_count,media.limit(12){...}}`

Dit werkt alleen voor zakelijke en creator-accounts; persoonlijke accounts zijn niet op te vragen (en dat willen we ook niet). We berekenen de engagement-rate als (likes + reacties) per post gedeeld door het aantal volgers, over de laatste 12 posts.
