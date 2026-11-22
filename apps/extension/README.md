# Trendscope voor Chrome (Manifest V3)

Laat op elke webshop zien wat Trendscope weet: platform, apps, geschatte omvang, live ads en de sterkste producten.

## Installeren (ontwikkeling)
1. `chrome://extensions` → zet Ontwikkelaarsmodus aan → **Uitgepakte extensie laden** → kies deze map (`apps/extension`).
2. De instellingen openen vanzelf. Vul het adres van je Trendscope-omgeving in (lokaal `http://localhost:3000`) en een API-sleutel met de scope `extension`. Die maak je in de app onder Instellingen → API, op elk plan waarvoor de flag `chrome_extension` aan staat.
3. Chrome vraagt toestemming voor alleen dát adres.

## Privacy
- Er zijn geen content scripts: de extensie leest nooit de inhoud van pagina's.
- Alleen de **hostnaam** van het actieve tabblad gaat naar je eigen Trendscope-omgeving, en alleen als de badge aan staat (instelbaar).
- De sleutel staat alleen lokaal (`chrome.storage.local`). Resultaten worden 10 minuten gecachet in `chrome.storage.session`.
- Alle tekst wordt met `textContent` weergegeven (geen HTML-injectie), en links gaan alleen naar je eigen Trendscope-adres.

## Scripts
- `pnpm --filter @trendscope/extension test`: unit-tests van de gedeelde logica (`src/lib.js`).
- `pnpm --filter @trendscope/extension pack`: maakt `dist/trendscope-extension-<versie>.zip` voor de Chrome Web Store.

De e2e-suite van de web-app laadt de extensie in Chromium (`e2e/api-integrations.spec.ts`).
