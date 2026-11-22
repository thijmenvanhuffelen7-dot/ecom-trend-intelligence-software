# ADR 0008 — Fase 8: watchlists, alerts, digests en integraties

Status: geaccepteerd · 2026-11-22

## Besluiten
1. **Regels als begrensde, getypeerde vragen** (zod-schema in `@trendscope/core`):
   - score boven of onder een grens;
   - faseverandering;
   - winkel voegt veel producten toe;
   - adverteerder start veel ads;
   - zoekterm groeit snel;
   - prijsdaling bij een concurrent;
   - nieuwe winkel in een niche.

   Geen vrije SQL of expressies: veilig, uitlegbaar en testbaar.
2. **Evaluatie in de web-app (TypeScript)**, gedeeld door de knop "Nu controleren" en de cron-route `/api/cron/alerts` (Vercel Cron, elke 15 minuten, beveiligd met `CRON_SECRET` en een vergelijking in constante tijd). Max. 20 treffers per regel per ronde.
3. **Dedupe met cooldown**: de sleutel is de entiteit plus het tijdvak van `cooldown_hours`, met een unieke index op `(rule_id, dedupe_key)`. Binnen de cooldown komt dezelfde melding nooit twee keer.
4. **Bezorging in de worker (Python)**, elke minuut:
   - Slack/Discord-webhooks, Telegram (Bot API), e-mail (Resend), en een generieke webhook;
   - de generieke webhook ondertekenen we met HMAC-SHA256 over `"<timestamp>.<body>"`;
   - retries met exponentiële backoff, na 5 pogingen `failed`;
   - foutmeldingen bevatten nooit URL's of tokens.
5. **SSRF-bescherming in twee lagen**:
   - bij opslaan: alleen https, poort 443, geen IP-literal of interne hostnaam, en Slack/Discord alleen op hun eigen domein;
   - bij verzenden: DNS-resolutie, met weigering van privé-, loopback-, link-local-, multicast- en gereserveerde adressen.
6. **Secrets versleuteld** (AES-256-GCM, `APP_ENCRYPTION_KEY`), in één formaat voor Node en Python (getest met een token over de taalgrens). De UI toont alleen een gemaskeerde hint.
7. **Digests** per gebruiker (uit, dagelijks of wekelijks): nieuwe meldingen, de sterkste kansen in de eigen niches en opkomende zoektermen. Zonder `RESEND_API_KEY` worden mails alleen gelogd (`outbound_emails`).

## Gevolgen
- De bel in de zijbalk toont het aantal ongelezen meldingen.
- Kanalen zijn per workspace. De planlimiet `alerts` geldt voor het aantal regels.
