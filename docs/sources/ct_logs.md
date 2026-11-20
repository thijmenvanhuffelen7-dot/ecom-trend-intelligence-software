# Bron: Certificate Transparency-logs (crt.sh)

| | |
|---|---|
| Connector-id | `ct_logs` |
| Type | scrape_public (publieke JSON-uitvoer van crt.sh) |
| Juridische status | **pending** |
| Persoonsgegevens | none: alleen domeinnamen uit TLS-certificaten. Certificaten met e-mailadressen in de naam slaan we over. |
| Retentie | 365 dagen (kandidaten); geaccepteerde domeinen worden een `store` |

## Wat we doen
Certificate Transparency (RFC 6962) is een openbaar register van alle uitgegeven TLS-certificaten. Een nieuw certificaat voor een domein is vaak het eerste teken dat er een winkel live gaat.

1. Per zoekterm (instelling `DISCOVERY_KEYWORDS`, bv. `beauty`, `pets`) vragen we `https://crt.sh/?q=%term%&output=json&exclude=expired&deduplicate=Y` op.
2. We normaliseren de namen: wildcards, `www.`, `mail.` en infra-subdomeinen eruit, en `*.myshopify.com` en cloud-hosts overslaan.
3. Nieuwe domeinen worden een kandidaat (`store_candidates`). De **store_probe** haalt daarna één keer de homepage op en herkent het platform.

## Technische afspraken
- 0,2 request per seconde; robots.txt van crt.sh wordt gerespecteerd.
- crt.sh is een gratis dienst van Sectigo. Voor grote volumes moeten we overstappen op een eigen CT-log-consumer (de officiële `get-entries`-API van de logs, of certstream). Die bron is technisch inwisselbaar: alleen `query_crtsh` verandert.

## Open vragen voor de jurist
- De gebruiksvoorwaarden van crt.sh bij periodiek automatisch bevragen.
- Is het opslaan van domeinnamen van (eenmanszaak-)winkels een persoonsgegeven? Onze inschatting: alleen in combinatie met andere gegevens. We slaan niets op over de eigenaar.
