# ADR 0006 — Fase 6: TikTok Shop, creators, video's en livestreams

Status: geaccepteerd · 2026-11-22

## Context
Social commerce (TikTok Shop, creators, livestreams) is het sterkste signaal voor wat er nú verkoopt. Tegelijk is het de lastigste bron: voor deze data van derden bestaat geen officiële API.

## Besluiten
1. **Officieel waar het kan**: YouTube Data API v3 en Instagram Business Discovery.
2. **TikTok Shop en TikTok-creators via een datapartner**, achter een connector die standaard op *pending/hoog risico* staat, met een neutraal contract (`social/partner.py`) en een adapter per partner. Geen eigen scraping.
3. **Verkopen uit tellerstanden.** We bewaren de verkochtteller per product als snapshot. Verkopen per dag of per 30 dagen zijn verschillen tussen onze eigen metingen, en GMV is altijd een schatting met methode en bandbreedte.
4. **Koppeling video → product.** Eerst via het productanker in de video (betrouwbaarheid 1,0), anders via de titel of het bijschrift (trigram, 0,7). Het bewijs staat in `entity_links.evidence`.
5. **Signalen.**
   - `tiktokshop` = verkochte stuks per dag per cluster;
   - `social` = videoviews per dag per cluster (verschil tussen snapshots).
   Beide worden net als de andere niveausignalen één keer gekalibreerd op bestaande historie.
6. **AVG.** Alleen publieke profielen. Contact alleen als zelf gepubliceerd zakelijk e-mailadres. Geen kijkers, volgers of reageerders.

## Gevolgen
- De Social-sectie heeft vijf rankings (producten, shops, creators, video's, livestreams) en creator-discovery met filters op volgers, engagement, niche, platform en zakelijk contact.
- De productpagina toont het TikTok Shop-aanbod (verkopen, GMV, commissie).
- De partnerkeuze is een zakelijke en juridische beslissing; de code is daarop voorbereid, maar zet niets aan.
