# ADR 0009 — Fase 9: AI-assistent, rapporten, ad-copy en creative-analyse

Status: geaccepteerd · 2026-11-23

## Besluiten
1. **Model**: Claude Opus 5.5 (`claude-opus-5-5`) voor alles: één model, één cache-namespace. Effort is per taak ingesteld: `medium` voor chat en ad-copy, `high` voor productrapporten, `low` voor creative-analyse in bulk. De server-side refusal-fallback (`fallbacks: "default"`) staat standaard aan, zodat een weigering binnen dezelfde aanroep door een ander model wordt opgevangen.
2. **Assistent = Messages API + tool runner, in onze eigen server.** De tools zijn alleen-lezende, begrensde (max. 15 rijen) en geparametriseerde queries op onze eigen database. Ze draaien binnen het verzoek van de gebruiker, met diens workspace-limieten. Managed Agents (gehoste loop en sandbox) is hier niet nodig: er zijn geen bestanden, geen langlopende sessies en geen code-uitvoering. Het antwoord streamt als NDJSON naar de browser.
3. **Nooit verzinnen.** De systeemprompt verplicht tool-gebruik, links naar de bron (app-paden) en het label "schatting" bij omzet, GMV en verkopen. De prompt is stabiel en wordt gecachet (`cache_control`).
4. **Gestructureerde output** voor rapporten en ad-copy (`beta.messages.parse` + zod), en voor creative-analyse in Python (Pydantic). Rapporten zijn gedeeld per product, 7 dagen geldig, en worden ververst zodra de onderliggende data verandert (hash van de input).
5. **Offline-modus zonder sleutel.** Dezelfde tools en schema's, met regelgebaseerde antwoorden en rapporten die expliciet als offline gelabeld zijn. De UI werkt dus altijd, en de tests draaien zonder API-kosten.
6. **Transcriptie**: de Claude API verwerkt geen audio. Daarom optioneel lokaal met faster-whisper (`WHISPER_MODEL`); zonder Whisper slaan we transcriptie over. **OCR en hook-analyse** gebeuren met Claude vision, alleen op beelden uit onze eigen opslag (geen hotlinking).
7. **Veilige weergave**: antwoorden worden met een eigen, minimale Markdown-renderer getoond (geen HTML-injectie, alleen links naar app-paden of https).
8. **Limieten**: elke vraag of elk rapport telt als `ai_assistant` in `usage_counters` (per maand, per plan). Boven de limiet volgt HTTP 402 met een duidelijke melding.

## Gevolgen
- Gesprekken worden per workspace opgeslagen als tekst en tool-namen, niet als ruwe API-payloads.
- Kosten: een assistentvraag kost doorgaans één tot drie modelaanroepen. Productrapporten worden gecachet. Creative-analyse draait één keer per ad.
