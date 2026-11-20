# Trendscope — veelgebruikte commando's. `make help` toont een overzicht.
SHELL := /bin/bash
COMPOSE := docker compose -f infra/docker/docker-compose.dev.yml
ENV := set -a; [ -f .env ] && . ./.env; set +a;

.PHONY: help setup dev-services stop migrate seed simulate screenshots index dev worker tick discover test lint typecheck e2e check clean

help: ## Toon deze hulp
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[32m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Installeer alle dependencies (pnpm + uv) en maak .env aan
	@[ -f .env ] || cp .env.example .env
	pnpm install
	cd workers && uv sync

dev-services: ## Start Postgres, ClickHouse, Redis, Meilisearch, MinIO en Mailpit
	$(COMPOSE) up -d --wait

stop: ## Stop de services
	$(COMPOSE) down

migrate: ## Draai Postgres- én ClickHouse-migraties
	$(ENV) pnpm -s db:migrate
	$(ENV) cd workers && uv run trendscope migrate-clickhouse

seed: ## Demowereld seeden, 14 dagen crawls + discovery simuleren en de zoekindex vullen
	$(ENV) cd workers && uv run trendscope seed
	$(MAKE) simulate screenshots index

simulate: ## Speel 14 dagen crawls en discovery af op het nep-internet (mock-modus)
	$(ENV) cd workers && uv run trendscope simulate --days 14

screenshots: ## Screenshots van ontdekte winkels (Playwright → S3)
	-$(ENV) cd workers && uv run trendscope screenshots --limit 50

index: ## (Her)indexeer winkels en producten in Meilisearch
	-$(ENV) cd workers && uv run trendscope index-search

worker: ## Start Celery: scheduler (beat) + crawl-worker
	$(ENV) cd workers && uv run celery -A trendscope.worker.celery_app worker -B -Q default,crawl --loglevel=INFO

tick: ## Eén schedulerronde zonder Celery (handig tijdens ontwikkelen)
	$(ENV) cd workers && uv run trendscope tick

discover: ## Discovery nu draaien (CT-logs + ad-landingspagina's → probe)
	$(ENV) cd workers && uv run trendscope discover

dev: ## Start de web-app op http://localhost:3000
	$(ENV) pnpm --filter @trendscope/web dev

test: ## Unit-tests (TypeScript + Python)
	pnpm -r --if-present test
	cd workers && uv run pytest -q

lint: ## Linters
	cd workers && uv run ruff check . && uv run ruff format --check .

typecheck: ## Typecheck (TypeScript + mypy)
	pnpm -r --if-present typecheck
	cd workers && uv run mypy

e2e: ## End-to-end-tests (vereist draaiende services + seed)
	$(ENV) pnpm --filter @trendscope/web e2e

check: lint typecheck test ## Alles wat CI ook draait (behalve e2e)

clean: ## Verwijder build-artefacten
	rm -rf apps/web/.next node_modules/.cache workers/.pytest_cache workers/.mypy_cache
