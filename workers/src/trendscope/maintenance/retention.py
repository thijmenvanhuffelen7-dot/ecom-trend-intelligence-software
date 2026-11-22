"""Bewaartermijnen (zie de privacyverklaring): ruimt dagelijks op wat we niet langer mogen of hoeven te bewaren."""

from datetime import datetime, timedelta
from typing import Any

import psycopg

# (tabel, tijdkolom, bewaartermijn, extra voorwaarde)
RULES: list[tuple[str, str, timedelta, str]] = [
    ("audit_logs", "created_at", timedelta(days=365), "TRUE"),
    ("api_rate_windows", "window_start", timedelta(hours=1), "TRUE"),
    ("stripe_events", "received_at", timedelta(days=90), "processed_at IS NOT NULL"),
    ("outbound_emails", "created_at", timedelta(days=90), "status IN ('sent', 'logged', 'failed')"),
    ("workspace_invitations", "expires_at", timedelta(days=30), "accepted_at IS NULL"),
    ("usage_counters", "period_start", timedelta(days=400), "TRUE"),
]


def apply_retention(conn: psycopg.Connection[Any], now: datetime) -> dict[str, int]:
    """Verwijdert verlopen rijen per regel; geeft per tabel het aantal verwijderde rijen terug."""
    out: dict[str, int] = {}
    for table, column, keep, extra in RULES:
        # Tabel- en kolomnamen komen uit de vaste lijst hierboven, nooit uit invoer
        cur = conn.execute(f"DELETE FROM {table} WHERE {column} < %s AND {extra}", (now - keep,))  # noqa: S608
        out[table] = cur.rowcount
    conn.commit()
    return out
