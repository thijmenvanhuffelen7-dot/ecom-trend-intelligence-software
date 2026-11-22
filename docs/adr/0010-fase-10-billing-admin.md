# ADR 0010 — Fase 10: billing, limieten, team en admin

Status: geaccepteerd · 2026-11-22

## Besluiten
1. **Stripe als enige betaalbron.**
   - Checkout (abonnement, 7 dagen trial bij de eerste aankoop, Stripe Tax voor btw, btw-nummer, factuuradres verplicht, kortingscodes) en het klantportaal (betaalmethode, facturen, opzeggen, plan wisselen).
   - Wij slaan geen kaartgegevens op.
   - Prijzen staan als `price_…`-ID's in de omgeving (`STRIPE_PRICE_<PLAN>_<MONTH|YEAR>`) en zijn dus zonder deploy te wijzigen.
2. **De webhook is de waarheid.**
   - Plan en status volgen uit `customer.subscription.*` en `invoice.*`, niet uit de redirect na Checkout.
   - Elk event wordt precies één keer verwerkt: eerst in `stripe_events` met het event-ID als sleutel, en een event dat er al staat slaan we over. Zo zijn dubbele of te late events onschadelijk.
   - De handtekening wordt altijd gecontroleerd (`STRIPE_WEBHOOK_SECRET`).
3. **Demo-checkout zonder sleutel.**
   - Zonder `STRIPE_SECRET_KEY` doet "Kies plan" hetzelfde in de app (plan, status `demo`, factuurregel met 21% btw), maar er wordt niets afgerekend.
   - Overal staat het label "Demo-abonnement". Zo zijn de UI en de e2e-tests volledig zonder Stripe-account te gebruiken.
4. **Trial.**
   - Nieuwe workspaces starten op Pro met status `trialing` (7 dagen).
   - Na afloop zonder betaald abonnement zet de sessie de workspace bij de eerstvolgende request op Free. De data blijft; alleen de limieten en het historievenster gaan omlaag.
   - `trial_used` voorkomt een tweede trial via Checkout.
5. **Limieten op één plek** (`packages/core/plans.ts`) en overal afgedwongen.
   | Limiet | Waar het wordt afgedwongen |
   |---|---|
   | Zoekopdrachten per dag | explorer, alleen echte zoekopdrachten. Typen in de snelzoekbalk telt niet. Boven de limiet zie je de lijst zonder zoekterm, met een upsell. |
   | Gevolgde winkels | watchlist |
   | Alertregels | alerts |
   | Exports per maand | CSV-export |
   | AI-vragen | assistent en rapporten |
   | Seats | leden + openstaande uitnodigingen |
   | Historievenster | product- en winkeldetail |

   Tellers staan in `usage_counters` en worden atomair opgehoogd (`ON CONFLICT … WHERE used < limit`), zodat gelijktijdige requests de limiet niet kunnen overschrijden.
6. **Team-uitnodigingen.**
   - Het token staat alleen in de link; wij bewaren de sha256.
   - Een uitnodiging is 7 dagen geldig en alleen te accepteren met het e-mailadres waarvoor ze bedoeld is.
   - Een nieuwe uitnodiging voor hetzelfde adres trekt de vorige in.
   - Openstaande uitnodigingen tellen mee als seat. Een advisory lock per workspace voorkomt dat gelijktijdige uitnodigingen samen de limiet passeren.
   - Bij het accepteren controleren we de limiet opnieuw, voor het geval het plan intussen omlaag is gegaan.
   - Wie lid is van meerdere workspaces, kiest er een met de cookie `ts_ws`. Dat is alleen een voorkeur: het lidmaatschap wordt bij elke sessie opnieuw gecontroleerd.
   - Met Clerk-organisaties beheert Clerk het team.
7. **Platformbeheer staat los van workspace-rollen.**
   - Alleen `users.is_platform_admin` of `PLATFORM_ADMIN_EMAILS` geeft toegang tot `/admin`; voor alle anderen geeft die pagina een 404.
   - Elke beheeractie komt in `audit_logs` (planoverride, beheerrechten, gewichten, flags, curatie).
   - Je kunt je eigen beheerrechten niet intrekken.
8. **Scoregewichten zijn geversioneerd.**
   - Een wijziging maakt altijd een nieuwe versie, als concept of direct actief. Een partiële unieke index garandeert precies één actieve versie.
   - Scores en backtests verwijzen naar hun versie, en het admin-paneel toont de backtest-precisie per versie, zodat een wijziging op meetbare winst te beoordelen is.
9. **Feature flags.**
   - Aan/uit, een percentage workspaces en optioneel een beperking tot bepaalde plannen.
   - De bucket is een FNV-1a-hash van `flag:workspace`: stabiel per workspace en in elke taal na te bouwen.
   - Flags voor de fase-11-functies staan in de seed.
10. **Planoverride door beheer.** Een handmatig plan zonder Stripe-abonnement krijgt status `demo`, zodat het in de cijfers niet als betaald telt. Bij een actief Stripe-abonnement wint de volgende webhook.

## Gevolgen
- Om live te gaan zijn nodig: een Stripe-account met Tax geactiveerd, zes prijs-ID's, een webhook naar `/api/webhooks/stripe` en het klantportaal geconfigureerd (plannen wisselen en opzeggen aan).
- Seats worden met Clerk-organisaties (nog) niet tegen het plan afgedwongen. Dat kan later via de Clerk-webhook `organizationMembership.created`.
- Uitnodigingsmails gaan via dezelfde uitgaande wachtrij als digests (Resend; zonder sleutel alleen gelogd). De uitnodiger ziet de link ook direct, om te kopiëren.
