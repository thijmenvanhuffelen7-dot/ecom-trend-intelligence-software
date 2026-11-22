# ADR 0012 — Fase 12: lancering (publieke site, privacy, onboarding, deploy)

Status: geaccepteerd · 2026-11-22

## Besluiten
1. **Publieke pagina's** (`/`, `/pricing`, `/developers`, `/privacy`, `/terms`) zijn server-rendered en hebben een gedeelde kop en voet.
   - De landingspagina gebruikt echte screenshots van de app (`next/image`, AVIF/WebP) en doet alleen claims die de code waarmaakt: geen creditcard voor de trial, schattingen gelabeld, officiële bronnen.
   - De juridische teksten zijn **concepten** en zo gemarkeerd. Ze moeten vóór de lancering getoetst worden.
2. **Privacy in de code afgedwongen, niet alleen beschreven.**
   - Dagelijkse bewaartaak (`trendscope retention`):
     | Wat | Hoe lang |
     |---|---|
     | Audit logs | 1 jaar |
     | Verwerkte Stripe-events | 90 dagen |
     | Uitgaande mails | 90 dagen |
     | Verlopen uitnodigingen | 30 dagen |
     | Tellers | ~13 maanden |
     | Rate-limitvensters | 1 uur |
   - AI-gesprekken zijn te verwijderen.
   - Een workspace is definitief te verwijderen: eigenaar, naam typen, geen lopend betaald abonnement, cascade over alle workspace-data.
   - Wie zijn workspace verwijdert, krijgt bij een nieuwe workspace geen tweede trial.
3. **Fail closed op authenticatie.** Met `APP_ENV=production` weigeren de dev-login en de middleware te werken (503) zolang `AUTH_MODE=clerk` niet is gezet. Een vergeten variabele kan dus nooit "inloggen met elk e-mailadres" in productie opleveren.
4. **Beveiligingsheaders** op alle routes:
   - CSP zonder externe scripts, met `frame-ancestors 'none'`, en `form-action` alleen naar Stripe;
   - HSTS met preload, nosniff, een strikte Referrer-Policy, Permissions-Policy en COOP.
   - `'unsafe-inline'` voor scripts blijft nodig zolang Next.js geen nonces krijgt. Dat is een bewuste afweging.
5. **Onboarding**: een checklist "Aan de slag" op Home, afgeleid uit wat de workspace al gedaan heeft (winkel volgen, product bewaren, alert, assistent, team). Er is geen extra status nodig, en de checklist verdwijnt vanzelf.
6. **Deploy**:
   - de web-app op Vercel (EU), en de workers en datastores op Hetzner (EU), uitgerold met Docker Compose en ingericht met een Terraform-skelet (hcloud: server, privénetwerk, firewall, volume);
   - een deploy-workflow met een goedgekeurde environment: image naar GHCR → Postgres-migraties → workers → Vercel;
   - CI bouwt het worker-image, doet er een rooktest op, en valideert Terraform en Compose.
7. **Build achter proxy's**: de Dockerfile accepteert een optionele CA als BuildKit-secret (die komt nooit in een laag), haalt Debian-pakketten via https, en heeft een instelbaar basisimage (bv. de ECR-spiegel bij Docker Hub-limieten).

## Gevolgen
- In deze ontwikkelomgeving was de volledige image-build niet te voltooien (`deb.debian.org` valt buiten de netwerk-allowlist), en Terraform-validatie kon niet lokaal draaien. Beide draaien in CI.
- Zie [docs/DEPLOY.md](../DEPLOY.md) en [docs/LAUNCH_CHECKLIST.md](../LAUNCH_CHECKLIST.md).
