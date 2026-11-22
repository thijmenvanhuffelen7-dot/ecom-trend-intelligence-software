# ADR 0011 — Fase 11: publieke API, Chrome-extensie, push-to-store en leads

Status: geaccepteerd · 2026-11-22

## Besluiten
1. **API v1 is alleen-lezen en hergebruikt de queries van de app.**
   - `/api/v1/products`, `/stores`, `/trends` en `/leads` gebruiken dezelfde parsers en queries als de explorers. Filters, scores en uitleg zijn dus identiek aan wat je in de UI ziet.
   - Een eigen, stabiel JSON-formaat (`server/api/serialize.ts`): snake_case, ISO-datums, en schattingen in een object met `is_estimate: true`.
2. **API-sleutels**: `ts_live_` + 32 tekens base62 (~190 bits).
   - We bewaren alleen het prefix en de sha256. De vergelijking is constant-time en de volledige sleutel wordt één keer getoond.
   - Scopes per sleutel (`read:products`, `read:stores`, `read:trends`, `read:leads`, `extension`), maximaal 10 actieve sleutels per workspace, en intrekken werkt direct.
3. **Limieten in twee lagen.**
   - Een vast venster van één minuut per sleutel (120 verzoeken) in een UNLOGGED Postgres-tabel, met een atomaire upsert. Er is geen Redis-client nodig in de web-app en het werkt serverless.
   - Daarbovenop het maandquotum van het plan (`api_access`, via `usage_counters`).
   - Volgorde: sleutel → scope → plan → minuut → quotum. Een geweigerd verzoek telt niet mee voor het quotum.
   - Headers: `X-RateLimit-*`, `X-Quota-*`, en `Retry-After` bij een 429.
4. **CORS open voor de API.** Authenticatie loopt via een Bearer-header, nooit via cookies, dus een open `Access-Control-Allow-Origin` geeft geen CSRF-risico.
5. **OpenAPI 3.1 als enige bron.** `/api/v1/openapi.json` en de pagina `/developers` komen uit hetzelfde document.
6. **Chrome-extensie (MV3) zonder build-stap en zonder content scripts.**
   - Alleen de hostnaam van het actieve tabblad gaat naar de eigen Trendscope-omgeving.
   - Host-toegang wordt pas gevraagd voor dat ene adres (`optional_host_permissions`).
   - De sleutel heeft de scope `extension`: alleen winkel-lookup per domein, op elk plan met de flag `chrome_extension`, buiten het API-quotum (wel onder de minuutlimiet).
   - Resultaten worden 10 minuten gecachet in `chrome.storage.session`.
7. **Push-to-store** maakt alleen concepten (`DRAFT`) via de Shopify Admin GraphQL API, met een custom-app-token dat versleuteld wordt opgeslagen.
   - Geen afbeeldingen of teksten van andere winkels (auteursrecht).
   - In `DATA_MODE=mock` wordt alles gesimuleerd en gelabeld als "Demo-koppeling".
   - Zie [docs/sources/shopify_admin_push.md](../sources/shopify_admin_push.md).
8. **B2B-leads** bevatten alleen publieke bedrijfsgegevens, geen persoonsgegevens.
   - Het quotum telt per geleverde rij. De reservering is atomair: `ON CONFLICT DO UPDATE` vergrendelt de tellerrij tot de commit.
   - Zie [docs/legal/b2b-leads.md](../legal/b2b-leads.md).

## Gevolgen
- Voor productie nodig:
  - de extensie publiceren in de Chrome Web Store (met de privacyverklaring hierboven);
  - de standaard `DEFAULT_BASE` in `apps/extension/src/lib.js` op het echte domein zetten;
  - `DATA_MODE=live` voor echte Shopify-pushes.
- De minuutvensters groeien met het verkeer; oude vensters worden willekeurig in ongeveer 1% van de verzoeken opgeruimd (ouder dan een uur).
