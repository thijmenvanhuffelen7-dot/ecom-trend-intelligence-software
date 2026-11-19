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
    elif args.cmd == "connectors":
        from trendscope.connectors.base import load_manifests

        for m in load_manifests().values():
            print(f"{m.id:28} {m.kind:14} legal_review={m.legal_review}")
