# Bron: YouTube Data API v3

| | |
|---|---|
| Connector-id | `youtube_data` |
| Type | official_api |
| Juridische status | **pending**. De YouTube API Services Terms eisen o.a. dat opgeslagen statistieken periodiek worden ververst of verwijderd, en een privacyverklaring die naar die van Google verwijst. |
| Credentials | `YOUTUBE_API_KEY` |

## Wat we ophalen
- `search.list` (type=video, q="<zoekterm> review", order=date, publishedAfter=30 dagen): **100 quota-eenheden per aanvraag**, dus spaarzaam.
- `videos.list` (snippet, statistics; max. 50 id's per keer) en `channels.list` (snippet, statistics): 1 eenheid per aanvraag.

Met het standaardquotum (10.000 eenheden per dag) zijn dat ongeveer 90 zoektermen per dag.

## Gebruik
Reviewvideo's en kanalen worden creators (platform youtube). Een video koppelen we aan een product als de titel overeenkomt (trigram); dat telt mee in het **social**-signaal.
