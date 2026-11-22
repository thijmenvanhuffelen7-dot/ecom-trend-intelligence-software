# Bron: seed-mailboxen (nieuwsbrieven van gevolgde winkels)

| | |
|---|---|
| Connector-id | `seed_mailbox` |
| Type | user_provided |
| Juridische status | **pending**. Wij schrijven ons met een eigen adres in op openbare nieuwsbrieven, zoals elke bezoeker kan. Te toetsen: de voorwaarden van individuele winkels, en het tonen van (delen van) mails in een betaald product (citaatrecht, merkrecht). |
| Credentials | `EMAIL_IMAP_HOST`, `EMAIL_IMAP_USER`, `EMAIL_IMAP_PASSWORD`; eigen domein via `EMAIL_SEED_DOMAIN` |

## Hoe het werkt
1. **Inschrijven**: per winkel een eigen plus-adres (`inbox+s<id>@<domein>`) via het standaard Shopify-formulier (`POST /contact`, `form_type=customer`, tag `newsletter`).
   - We respecteren robots.txt en de rate limits (1 verzoek per 5 seconden per domein).
   - **Verschijnt er een CAPTCHA of challenge, dan omzeilen we die niet.** De inschrijving wordt dan `manual`.
2. **Inlezen**: IMAP over TLS, alleen-lezen (`BODY.PEEK`). We markeren niets als gelezen en verwijderen niets. Inlezen gebeurt per UID en idempotent op Message-ID.
3. **Verwerken**: type (welkom, bevestiging, promotie, lancering, nieuwsbrief, verlaten winkelmand, transactioneel), hoogste procentkorting, kortingscode, gratis verzending, urgentie en het verzendplatform (uit de headers). Productlinks (`/products/<handle>`) koppelen we aan producten van de winkel.
4. **Weergave**: de HTML wordt gesaneerd. Scripts, frames, formulieren, event-handlers en trackingpixels gaan eruit, en externe afbeeldingen worden pas na een klik geladen. Daarna tonen we de mail in een iframe met sandbox (geen scripts, geen same-origin).

## AVG
De mailbox is van ons en ontvangt alleen marketingmail van bedrijven. Er zitten geen persoonsgegevens van eindklanten in. Uitschrijven kan via `List-Unsubscribe`; een winkel die dat vraagt, halen we eruit.
