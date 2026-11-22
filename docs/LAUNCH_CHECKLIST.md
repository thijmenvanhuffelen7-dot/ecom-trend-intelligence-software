# Launch-checklist

Afvinken vóór de eerste betalende klant. ✅ = geregeld in de code of config, ☐ = actie van het team.

## Juridisch en privacy
- ☐ Privacyverklaring en voorwaarden laten toetsen. De concepten staan op `/privacy` en `/terms`; vul entiteit, adres, KvK en de bevoegde rechter in.
- ☐ Verwerkersovereenkomsten met de hosting, Stripe, Resend, Anthropic en Clerk.
- ☐ Per connector een juridische toets en `legal_review: approved` in het manifest (zie `docs/sources/`). Commerciële licenties:
  - Reddit (verplicht voor commercieel gebruik);
  - DataForSEO;
  - TikTok Research/Commercial Content API (beperkt tot onderzoek: alternatief kiezen);
  - Amazon Creators API.
- ☐ `META_SNAPSHOT_CAPTURE` en `STORE_MARKETPLACE_IMAGES` alleen aanzetten met juridisch akkoord.
- ✅ Geen persoonsgegevens van eindklanten. Creators: alleen publieke, zakelijke gegevens. Leads: alleen bedrijfsgegevens (`docs/legal/b2b-leads.md`).
- ✅ Bewaartermijnen worden afgedwongen (`trendscope retention`, dagelijks).
- ✅ Je kunt een workspace verwijderen en AI-gesprekken wissen.
- ✅ Alle schattingen zijn gelabeld, in de UI en in de API (`is_estimate`).

## Beveiliging
- ✅ Beveiligingsheaders (CSP, HSTS, frame-ancestors, nosniff, Permissions-Policy) in `next.config.ts`.
- ✅ Gevoelige tokens:
  - kanalen en winkelkoppelingen versleuteld met AES-256-GCM;
  - API-sleutels en uitnodigingen alleen als hash;
  - webhooks ondertekend (HMAC), met een SSRF-guard op uitgaande webhooks.
- ✅ Rate limits en quota op de API. Beheeracties staan in de audit log.
- ☐ `APP_ENCRYPTION_KEY`, `AUTH_SECRET` en `CRON_SECRET` opnieuw genereren voor productie (`openssl rand -base64 32`), en een rotatieplan vastleggen.
- ☐ `PLATFORM_ADMIN_EMAILS` beperken tot het eigen team. Dus níet `@trendscope.dev`, dat alleen voor dev en CI bedoeld is.
- ☐ Clerk in productie (`AUTH_MODE=clerk`) en de dev-login uitzetten. De dev-login weigert zonder `AUTH_SECRET` en hoort alleen lokaal te draaien.
- ☐ Security-review of pentest van de publieke API en de webhooks.

## Betalingen
- ☐ Stripe live-modus: Tax geactiveerd, zes prijzen, webhook en klantportaal. Doorloop één echte aankoop, een opzegging en een mislukte betaling (testklok).
- ✅ Webhooks zijn idempotent, getest met ondertekende events.

## Data en kwaliteit
- ☐ `DATA_MODE=live`, met de eerste set winkels (`trendscope import-domains`) en de zoekindex opgebouwd.
- ☐ Na 2–4 weken echte data: `trendscope backtest` draaien en de scoregewichten bijstellen.
- ☐ Een echt embeddingmodel voor de clustering (nu hashing-gebaseerd).

## Operatie
- ☐ Monitoring: uptime van `/api/health`, foutmeldingen (bv. Sentry), en alerts op dead letters (`/admin` → Overzicht).
- ☐ Back-ups: dagelijkse PITR voor Postgres, en ClickHouse-back-ups naar object storage. Test een restore.
- ☐ Status- en supportkanaal en een e-mailadres voor privacyverzoeken (`privacy@…`).
- ✅ CI: lint, types, unit, integratie, e2e (47 tests), de image-build en Terraform-validatie.

## Extensie
- ☐ `DEFAULT_BASE` in `apps/extension/src/lib.js` op het productiedomein zetten, `pnpm --filter @trendscope/extension pack` draaien en uploaden naar de Chrome Web Store, met de privacytekst uit `apps/extension/README.md`.
