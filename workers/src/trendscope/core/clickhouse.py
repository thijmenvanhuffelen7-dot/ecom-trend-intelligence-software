from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from trendscope.core.settings import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parents[4] / "db" / "clickhouse" / "migrations"


def get_client(url: str | None = None) -> Client:
    parts = urlsplit(url or get_settings().clickhouse_url)
    return clickhouse_connect.get_client(
        host=parts.hostname or "localhost",
        port=parts.port or 8123,
        username=parts.username or "default",
        password=parts.password or "",
        database=parts.path.lstrip("/") or "default",
        secure=parts.scheme == "https",
    )


def split_statements(sql: str) -> list[str]:
    """Statements worden gescheiden door een regel met alleen ';'."""
    chunks: list[str] = []
    current: list[str] = []
    for line in sql.splitlines():
        if line.strip() == ";":
            chunks.append("\n".join(current))
            current = []
        else:
            current.append(line)
    chunks.append("\n".join(current))
    stripped = ["\n".join(ln for ln in c.splitlines() if not ln.strip().startswith("--")).strip() for c in chunks]
    return [s for s in stripped if s]


def migrate(client: Client | None = None, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Voert nog niet toegepaste migraties uit, in volgorde van bestandsnaam."""
    client = client or get_client()
    client.command(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version String, applied_at DateTime DEFAULT now()) "
        "ENGINE = MergeTree ORDER BY version"
    )
    applied = {row[0] for row in client.query("SELECT version FROM schema_migrations").result_rows}
    done: list[str] = []
    for path in sorted(directory.glob("*.sql")):
        version = path.stem.split("_", 1)[0]
        if version in applied:
            continue
        for statement in split_statements(path.read_text()):
            client.command(statement)
        client.insert("schema_migrations", [[version]], column_names=["version"])
        done.append(path.name)
    return done
