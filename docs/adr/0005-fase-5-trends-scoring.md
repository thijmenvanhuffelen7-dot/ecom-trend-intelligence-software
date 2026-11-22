# ADR 0005 — Fase 5: trenddetectie, live scoring en backtesting

Status: geaccepteerd · 2026-11-21

## Context
Tot fase 4 kwamen de scores uit de seed. Nu berekenen we ze dagelijks uit echte metingen, voegen we vraagsignalen toe (zoekinteresse, Reddit, hashtags) en willen we kunnen aantonen dat de scores iets voorspellen.

## Besluiten
1. **Zoekinteresse via DataForSEO.** De officiële Google Trends API is nog alpha. Opslag per keyword, land en dag in ClickHouse (`keyword_signals_daily`). De connector is later te vervangen door de officiële API.
2. **Reddit via de officiële OAuth-API**, zonder gebruikersnamen. Hashtags leiden we af uit teksten die we al hebben (ads, later video's): geen extra bron of scraping.
3. **Live signalen in dezelfde eenheid als de historie** (aantal winkels, actieve ads, verkopen per dag, index, vermeldingen per dag). Waar een niveausignaal voor het eerst live wordt gemeten terwijl er al historie is, leggen we één schaalfactor vast (`signal_scales`: gemiddelde van de 7 dagen ervoor gedeeld door de eerste live meting). Dat voorkomt een kunstmatige sprong, en de factor is per reeks te controleren.
4. **Pas scoren na 7 dagen data.** Daarvoor toont de UI "Score volgt".
5. **Forecast met Holt-Winters** (additief, weekseizoen, gedempte trend, grid search op de één-stap-fout), met een ~90%-band uit de residuen. Prophet of gradient boosting voegt bij korte, ruisige reeksen zonder extra features weinig toe en maakt de uitleg lastiger. De fout meten we eerlijk: het model wordt zonder de laatste 14 dagen gefit en daarop beoordeeld (MAPE).
6. **Seizoen vereist herhaling.** Op basis van één jaar is een seizoen niet van een trend te onderscheiden. We vergelijken het maandprofiel van het laatste jaar met dat van het jaar ervoor (correlatie ≥ 0,7 en een amplitude van minstens 20%).
7. **Keywordfase** komt uit de 30-dagengroei en uit hoe nieuw de interesse is (laatste 30 dagen ten opzichte van het eerste jaar). Dezelfde regels staan in Python (worker) en TypeScript (filter per land), met identieke tests.
8. **Backtesting zonder lek.** De reeksen worden afgeknipt op de cutoff (14, 21 en 30 dagen geleden) en gescoord met dezelfde engine en gewichten. Daarna vergelijken we met de vraaggroei die volgde: Spearman, precisie@10, AUC en de basiskans. De backtest draait wekelijks en staat in admin.

9. **Eerste afstelling via de backtest.** Met de oorspronkelijke venstermix (1/7/30 dagen = 0,2/0,5/0,3) haalde de top-10 minder doorbraken dan toeval: opkomende producten groeiden daarna het hardst, maar de 30-dagengroei verdunde hun recente explosie. Met 0,3/0,6/0,1 steeg Spearman op 14/21/30 dagen van 0,37/0,42/0,39 naar 0,49/0,53/0,57 (AUC 0,65 → 0,69). **Kanttekening:** dit is gemeten op de demowereld. Met echte data moet de afstelling opnieuw gebeuren (per gewichtsversie, met dezelfde backtest), en blijft overfitting een risico zolang de populatie klein is.

## Gevolgen
- Elke dag: hashtags → signalen → scores → forecasts (Celery beat 04:50 UTC; CLI `trendscope score`).
- Kalibratiefactoren en backtests zijn tabellen, dus altijd terug te lezen.
- De gewichten blijven configureerbaar per versie; fase 10 voegt het bewerken in admin toe.
