# Deployen naar productie

Architectuur: de **web-app op Vercel** (EU-regio `fra1`), en de **workers en datastores op Hetzner Cloud** (EU), met **Postgres managed**. Voorbeelden van managed Postgres: Neon of Supabase in de EU, of Hetzner met pgvector.

```
Vercel (Next.js) ──TLS──► Postgres (managed, pgvector)
      │                      ▲
      └──HTTPS──► Meilisearch, ClickHouse (alleen via privénetwerk/tunnel, zie onder)
Hetzner: worker(s) + beat ──► Redis, ClickHouse, Meilisearch, S3 (Hetzner Object Storage)
```

## 1. Infrastructuur (eenmalig)
```bash
cd infra/terraform
export TF_VAR_hcloud_token=…            # Hetzner-token, nooit in een bestand
cp prod.tfvars.example prod.tfvars      # SSH-sleutel, beheer-IP's, servertype
terraform init && terraform plan -var-file=prod.tfvars && terraform apply -var-file=prod.tfvars
```
Dit maakt de workerserver(s), een privénetwerk, een firewall (alleen SSH vanaf beheer-IP's) en een datavolume.

Daarna op de server:
- maak de gebruiker `deploy` aan (lid van de groep `docker`);
- maak `/opt/trendscope` aan;
- zet `.env.production` neer (`cp .env.production.example`, invullen).

## 2. Database
- Maak een managed Postgres 16 aan met de extensies `vector` en `pg_trgm`.
- De migraties draaien automatisch in de deploy-workflow (`pnpm db:migrate`), vóór elke uitrol.
- **Niet** `trendscope seed` draaien in productie: dat is de demowereld en wist datatabellen.

## 3. Vercel
- Maak een project met root directory `apps/web` en Framework Next.js. Zet de regio op `fra1`.
- Environment variables (Production):
  | Groep | Variabelen |
  |---|---|
  | Basis | `DATABASE_URL`, `CLICKHOUSE_URL`, `MEILISEARCH_URL`, `MEILISEARCH_MASTER_KEY` |
  | Sessie en encryptie | `AUTH_SECRET`, `APP_ENCRYPTION_KEY` (dezelfde als de workers), `APP_URL` |
  | Cron | `CRON_SECRET` |
  | Auth | `AUTH_MODE=clerk` + Clerk-sleutels |
  | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` |
  | Overig | `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `PLATFORM_ADMIN_EMAILS`, `DATA_MODE=live` |
- Vercel Cron leest `apps/web/vercel.json`: alert-evaluatie elke 15 minuten via `/api/cron/alerts`, beveiligd met `CRON_SECRET`.
- ClickHouse en Meilisearch zijn niet publiek. Maak ze bereikbaar voor Vercel via een TLS-proxy met een vaste allowlist, of gebruik de managed varianten (ClickHouse Cloud, Meilisearch Cloud) in de EU.

## 4. Stripe
- Zet Stripe Tax aan, maak drie producten met elk een maand- en een jaarprijs (EUR), en zet de zes `price_…`-ID's in Vercel.
- Webhook-endpoint `https://<app>/api/webhooks/stripe` met de events `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed` en `invoice.finalized`.
- Klantportaal: plannen wisselen en opzeggen aan, en facturen tonen.

## 5. Uitrollen
- GitHub → Actions → **Deploy** → Run workflow, of push een tag `v1.2.3`.
- De workflow bouwt het worker-image (GHCR), migreert Postgres, start de workers opnieuw (`docker compose pull && up -d`) en deployt de web-app naar Vercel.
- Geef de environment `production` verplichte reviewers, zodat elke uitrol expliciet wordt goedgekeurd.
- Benodigde secrets: `DATABASE_URL`, `DEPLOY_SSH_KEY`, `WORKER_HOST`, `VERCEL_TOKEN`, `VERCEL_ORG_ID` en `VERCEL_PROJECT_ID`.

## 6. Na de eerste uitrol
```bash
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production run --rm worker trendscope connectors
docker compose -f infra/docker/docker-compose.prod.yml --env-file .env.production run --rm worker trendscope index-search
```
- Zet connectors pas aan (in hun manifest `legal_review: approved`) na een juridische toets per bron. Zie `docs/sources/`.
- Draai `trendscope backtest` zodra er een paar weken echte data is, en stel de gewichten bij in `/admin` → Scoregewichten.

## Image lokaal bouwen
```bash
docker build -f workers/Dockerfile -t trendscope-workers .
# Achter een TLS-inspecterende proxy: --secret id=ca_bundle,src=/pad/naar/ca.crt
# Docker Hub-limiet: --build-arg PYTHON_IMAGE=public.ecr.aws/docker/library/python:3.13-slim
```
