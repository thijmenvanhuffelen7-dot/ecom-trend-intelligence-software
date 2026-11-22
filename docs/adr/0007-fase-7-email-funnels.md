# ADR 0007 — Fase 7: e-mailmarketing en funnel-analyse

Status: geaccepteerd · 2026-11-22

## Besluiten
1. **Eén mailbox, plus-adressen per winkel.** Afzenders wisselen (ESP-domeinen, subdomeinen), het ontvangstadres niet. Zo hangt elke mail ondubbelzinnig aan één winkel.
2. **IMAP, alleen-lezen.** Dat werkt met elke mailprovider en verandert niets aan de mailbox. De bron is een interface (`MailSource`): IMAP in productie, een statische bron voor de demo en de tests.
3. **Inschrijven via het openbare formulier, nooit langs een CAPTCHA.** Een challenge betekent `manual`. Een bevestigingsmail (double opt-in) in onze eigen inbox telt als bevestiging.
4. **Classificatie met regels (NL/EN/DE)** in plaats van een model: uitlegbaar, snel en goed te testen. Fase 9 kan een LLM toevoegen voor samenvattingen.
5. **Veilig tonen**: de HTML wordt gesaneerd (getest) en in een sandbox-iframe zonder scripts of same-origin getoond. Externe afbeeldingen zijn standaard geblokkeerd, zodat afzenders niet zien wie de mail bekijkt.
6. **Funnel uit technologiedetectie.** Tools worden per stap ingedeeld: landing, capture, product, winkelmand, checkout en retentie. Dertien nieuwe signaturen (pop-ups, spin-wheels, urgentie, bundels, upsells, gratis-verzendbalken, loyaliteit, quiz en chat) vullen de detectie aan.

## Gevolgen
- Celery haalt elk kwartier nieuwe mails binnen en schrijft één keer per dag nieuwe winkels in (gevolgde winkels eerst).
- Per winkel: mails per week (4 weken), gemiddelde korting en verzendplatform.
- Niet gedekt: flows die een winkelmand of bestelling vereisen (abandoned cart, post-purchase). Daarvoor zouden we namens een persoon moeten handelen, en dat doen we niet.
