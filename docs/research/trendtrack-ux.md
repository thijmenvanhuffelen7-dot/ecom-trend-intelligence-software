# Onderzoek: TrendTrack-UX als referentie

**Bronnen:** de twee screenshots van de opdrachtgever (Shop Explorer en winkeldetail), [trendtrack.io/features/shops](https://www.trendtrack.io/features/shops), [trendtrack.io/features/shop-analytics](https://www.trendtrack.io/features/shop-analytics), [trendtrackreview.com: filtergids](https://trendtrackreview.com/tutorials/mastering-trendtrack-filters-complete-guide) en [gethookd.ai: review](https://www.gethookd.ai/learn/trendtrack-reviews-pricing-features-is-this-ecommerce-intelligence-tool-legit/).

Directe toegang tot trendtrack.io was vanuit de bouwomgeving geblokkeerd. Wat hieronder "onbevestigd" heet, komt uit reviews van derden.

> We nemen **informatiearchitectuur en interactiepatronen** over: de indeling van filters, kolommen en secties. Logo, naam, kleuren en teksten nemen we **niet** over. Trendscope heeft een eigen merk en een eigen kleurenpalet.

## Navigatie
Zijbalk: Home · Explorer · Brandtracker · Trends · Boards · Academy. Onderin: meldingen, AI-chat, thema en account.

**Gebouwd:** Home, Explorer, Brandtracker, Trends en Boards (placeholder). Academy volgt bij de docs in fase 12.

## Explorer
- **Tabs:** Q4 mode · Shops · Ads · Advertisers · Emails · Images. **Gebouwd:** Shops, Producten (nieuw: onze scores), Ads, Adverteerders, en E-mails/Afbeeldingen als placeholder.
- **Opgeslagen weergaven:** All Shops · Weekly Gems · Top Scaling · Market Leader and DTC · Shops' Ad Peak · Shops' Traffic Peak. **Gebouwd** als `curated_lists`.
- **Shopfilters:** Visitor Countries, Shop Origin, Monthly Traffic, Niche, Products Count, Shop Creation Date, Traffic Growth, Pixels, Language, Shopify Theme, plus "6 more". **Gebouwd**, inclusief apps en valuta.
- **Filters voor pagina's/adverteerders:** Active Ads, Ads Growth, Advertisers. **Gebouwd:** Active Ads en Ads Growth.
- **Kolommen:** Shop · Niche · Best sellers · Visits/mo (+ landen, sparkline) · Meta (live ads, sparkline) · Latest activity (ad-thumbnails, "N Meta ads launched"). **Gebouwd.**
- **Ads-filters (reviews):** status, aanmaakdatum, laatst gezien, dagen actief, niche, land, taal, mediatype, CTA, technologie, videoduur, lengte van de advertentietekst. Spend en bereik alleen voor EU/UK (transparantiedata). **Gebouwd:** status, formaat, dagen actief, land, CTA. De rest volgt in fase 3.

## Winkeldetail
- **Kop:** categorie, land, taal, valuta, Shopify-thema, Trustpilot, socials, "Track in BrandTracker". **Gebouwd.**
- **Secties:** Monthly Visits (versus vorige maand), Estimated Monthly Revenue (bandbreedte), Traffic Over Time, Live Ads Over Time (7d/30d/90d), Traffic by Country, Traffic Sources / Social Networks (donut), Pixels / Shopify Apps, Products (Best Sales / Last Published), Social Media Followers. **Allemaal gebouwd.**
- **Toegevoegd** (onze differentiator): gekoppelde trendproducten met opportuniteitsscore en trendfase.
- **Niet gebouwd:** de Facebook-pagina-selector ("Select pages to track in BrandTracker"). Die komt in fase 3, met echte Meta-pagina's.

## Q4 mode (onbevestigd)
Volgens een review "spoelt" deze modus het dashboard terug naar Black Friday van vorig jaar. Wij kunnen dit bouwen met `score_history` en de snapshots (tijdreizen per datum).

## Vragen aan de opdrachtgever
Graag screenshots van de volgende schermen, dan kan ik ze nauwkeuriger nabouwen:
1. Home-dashboard
2. Ads-explorer met de filterbalk en een geopende ad (detail)
3. Advertiser-detail
4. Emails-tab en een geopende e-mail
5. Images-tab (zoeken op afbeelding?)
6. Brandtracker-overzicht en -detail (folders en delen)
7. Boards
8. Q4 mode
9. Het "6 more"-filtermenu
