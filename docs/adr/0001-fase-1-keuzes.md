# ADR 0001 — Keuzes en afwijkingen in fase 1

Datum: 2026-11-19 · Status: geaccepteerd

Het architectuurplan ([ARCHITECTURE.md](../ARCHITECTURE.md)) is goedgekeurd met de aanbevolen opties: Clerk, TypeScript voor de app-API, Vercel + Hetzner. Tijdens het bouwen zijn een paar keuzes aangescherpt.

| Onderwerp | Plan | Gebouwd | Waarom |
|---|---|---|---|
| Interne API | tRPC | **Server Components + Server Actions** | In de App Router lezen pagina's de data rechtstreeks op de server. Filters staan in de URL, dus pagina's zijn deelbaar en snel, zonder client-side datalaag. Mutaties (volgen, onboarding) zijn getypeerde server actions. tRPC voegt pas iets toe bij veel client-interactie, bijvoorbeeld de Chrome-extensie (fase 11). De publieke REST-API blijft gepland. |
| UI-componenten | `packages/ui` | `apps/web/components/ui` | Er is nog maar één consument. Een apart package wordt het zodra de Chrome-extensie of de docs-site componenten deelt. |
| i18n | `next-intl` met `[locale]`-routes | Eigen kleine i18n met cookie | De app zit achter een login, dus SEO via URL-locales is niet nodig. Dat scheelt een routelaag en middleware-complexiteit. De keys zijn typeveilig (`TKey`) en een test bewaakt dat NL en EN dezelfde keys hebben. Voor de marketingsite (fase 12) komen URL-locales. |
| ClickHouse-migraties | dbmate | Kleine eigen runner (`trendscope migrate-clickhouse`) | dbmate voert per ClickHouse-migratie maar één statement betrouwbaar uit. |
| Tabellen | TanStack Table | Server-gerenderde tabellen | Sorteren, filteren en pagineren gebeuren server-side via de URL (de eis voor 1M+ winkels). TanStack komt erbij voor client-functies zoals kolommen kiezen en verbergen. |
| Charts | Recharts of ECharts | ECharts (SVG-renderer) + eigen SVG-sparklines | Tabellen tonen tientallen sparklines per pagina; die worden zonder library server-side gerenderd. |
| Demo-media | — | `/media/demo/*.svg` | Deterministische SVG's voor productfoto's, shop-screenshots en ad-creatives. Er staan geen afbeeldingen van echte merken in de repo, en de UI ziet er toch echt uit. |

## Scoring-kalibratie

- De normalisatie mengt het percentiel binnen de categorie (50%) met de absolute groeisterkte (50%, `tanh`). Zo scoort de "beste" van een stilstaande categorie niet automatisch 100.
- Categorieën met minder dan 20 entiteiten worden samen genormaliseerd.
- De convergentiebonus is 5% per extra onafhankelijke groep.
- De trendfase wordt bepaald uit het niveau én de versnelling van de vraag: opkomend = de groei over 7 dagen is groter dan 45% van de groei over 30 dagen, bij lage saturatie.
- De parameters staan in `Params` en de gewichten in `score_weights` (met versienummer), zodat backtests in fase 5 ze kunnen tunen.
