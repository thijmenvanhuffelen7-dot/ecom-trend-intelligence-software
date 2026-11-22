from __future__ import annotations

import argparse
import json


def main() -> None:
    parser = argparse.ArgumentParser(prog="trendscope", description="Trendscope workers")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate-clickhouse", help="Voer ClickHouse-migraties uit")
    sub.add_parser("seed", help="Vul alle databases met de demo-dataset (wist bestaande data-tabellen)")
    crawl = sub.add_parser("crawl", help="Draai één connector voor één target (respecteert DATA_MODE)")
    crawl.add_argument("connector")
    crawl.add_argument("target")
    sub.add_parser("connectors", help="Toon alle connector-manifests")
    cs = sub.add_parser("crawl-store", help="Crawl één winkel nu via de volledige pipeline")
    cs.add_argument("domain")
    tick = sub.add_parser("tick", help="Eén schedulerronde: claim due targets en voer ze direct uit (zonder Celery)")
    tick.add_argument("--limit", type=int, default=None)
    sim = sub.add_parser("simulate", help="Mock-modus: speel N dagen crawls + discovery af tot vandaag")
    sim.add_argument("--days", type=int, default=14)
    sub.add_parser("discover", help="Verzamel kandidaat-winkels (CT-logs, ad-landingspagina's) en probe ze")
    imp = sub.add_parser("import-domains", help="Importeer domeinen (één per regel) als kandidaten")
    imp.add_argument("file")
    sub.add_parser("index-search", help="(Her)indexeer winkels en producten in Meilisearch")
    sub.add_parser(
        "cluster", help="Cluster producten zonder cluster (tekst + beeld) en voeg bijna-dubbele clusters samen"
    )
    sub.add_parser("score", help="Signalen per cluster afleiden, alle clusters scoren en forecasts maken (vandaag)")
    sub.add_parser("backtest", help="Speel de scoring af op 14/21/30 dagen geleden en meet de voorspelkracht")
    sub.add_parser("analyze-creatives", help="Analyseer nieuwe ads: OCR, hook, invalshoek, CTA, claims")
    shots = sub.add_parser("screenshots", help="Maak screenshots van ontdekte winkels (Playwright → S3)")
    shots.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    if args.cmd == "migrate-clickhouse":
        from trendscope.core.clickhouse import migrate

        applied = migrate()
        print(f"Toegepast: {', '.join(applied) or 'niets (alles up-to-date)'}")
    elif args.cmd == "seed":
        from trendscope.seed.generate import run

        print(json.dumps(run(), indent=2))
    elif args.cmd == "crawl":
        from trendscope.connectors.base import get_connector
        from trendscope.core.settings import get_settings

        records = get_connector(args.connector, get_settings()).run(args.target)
        for record in records:
            print(record.model_dump_json() if hasattr(record, "model_dump_json") else record)
        print(f"# {len(records)} records")
    elif args.cmd == "crawl-store":
        _crawl_store(args.domain)
    elif args.cmd == "tick":
        _tick(args.limit)
    elif args.cmd == "simulate":
        from trendscope.core.settings import get_settings
        from trendscope.scheduler.simulate import simulate

        print(json.dumps(simulate(get_settings(), args.days), indent=2))
    elif args.cmd == "discover":
        _discover()
    elif args.cmd == "import-domains":
        from datetime import UTC, datetime
        from pathlib import Path

        import psycopg

        from trendscope.core.settings import get_settings
        from trendscope.discovery.run import import_domains

        with psycopg.connect(get_settings().database_url) as conn:
            n = import_domains(conn, Path(args.file).read_text().splitlines(), datetime.now(UTC))
        print(f"{n} nieuwe kandidaten")
    elif args.cmd == "index-search":
        from trendscope.search.indexer import reindex_all

        print(json.dumps(reindex_all(), indent=2))
    elif args.cmd == "screenshots":
        from datetime import UTC, datetime

        import psycopg

        from trendscope.core.settings import get_settings
        from trendscope.media.screenshots import capture_store_screenshots

        settings = get_settings()
        with psycopg.connect(settings.database_url) as conn:
            print(dict(capture_store_screenshots(conn, settings, now=datetime.now(UTC), limit=args.limit)))
    elif args.cmd == "analyze-creatives":
        from trendscope.worker.tasks import analyze_creatives

        print(json.dumps(analyze_creatives(), indent=2))
    elif args.cmd == "score":
        from trendscope.worker.tasks import score_daily

        print(json.dumps(score_daily(), indent=2))
    elif args.cmd == "backtest":
        from trendscope.worker.tasks import backtest

        print(json.dumps(backtest(), indent=2))
    elif args.cmd == "cluster":
        from datetime import UTC, datetime

        import psycopg

        from trendscope.clustering.engine import cluster_products
        from trendscope.core.settings import get_settings

        with psycopg.connect(get_settings().database_url) as conn:
            print(json.dumps(cluster_products(conn, now=datetime.now(UTC)).as_dict(), indent=2))
    elif args.cmd == "connectors":
        from trendscope.connectors.base import load_manifests

        for m in load_manifests().values():
            print(f"{m.id:28} {m.kind:14} legal_review={m.legal_review}")


def _crawl_store(domain: str) -> None:
    from datetime import UTC, datetime

    import psycopg

    from trendscope.core.clickhouse import get_client
    from trendscope.core.settings import get_settings
    from trendscope.scheduler.runner import run_target

    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        row = conn.execute(
            "SELECT id FROM crawl_targets WHERE connector_id = 'shopify_storefront' AND target = %s", (domain,)
        ).fetchone()
        if row is None:
            raise SystemExit(f"Geen crawl-target voor {domain}")
        outcome = run_target(conn, get_client(), settings, row[0], now=datetime.now(UTC))
    print(json.dumps(outcome.stats if outcome else {}, indent=2, default=str))
    for e in (outcome.events if outcome else [])[:50]:
        print(f"  {e.type:20} {e.payload.get('title') or e.payload.get('name')}")


def _tick(limit: int | None) -> None:
    from datetime import UTC, datetime

    import psycopg

    from trendscope.core.clickhouse import get_client
    from trendscope.core.settings import get_settings
    from trendscope.scheduler.due import claim_due
    from trendscope.scheduler.runner import run_target

    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        now = datetime.now(UTC)
        targets = claim_due(
            conn,
            now=now,
            limit=limit or settings.scheduler_batch,
            lease_minutes=settings.crawl_lease_minutes,
            production=settings.is_production,
        )
        ch = get_client()
        for t in targets:
            outcome = run_target(conn, ch, settings, t.id, now=datetime.now(UTC))
            print(f"{t.target:30} {outcome.status if outcome else 'failed':10} {outcome.stats if outcome else ''}")
    print(f"# {len(targets)} targets uitgevoerd")


def _discover() -> None:
    from datetime import UTC, datetime

    import psycopg

    from trendscope.core.settings import get_settings
    from trendscope.discovery.run import discover_and_probe

    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        print(dict(discover_and_probe(conn, settings, now=datetime.now(UTC))))
