"""Targets claimen voor uitvoering. Veilig bij meerdere schedulers/workers dankzij FOR UPDATE SKIP LOCKED + lease."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import psycopg
from psycopg.rows import class_row


@dataclass
class Target:
    id: int
    connector_id: str
    target: str
    entity_id: int | None
    priority: int
    failures: int


CLAIM_SQL = """
UPDATE crawl_targets t SET leased_until = %(lease)s
FROM (
  SELECT ct.id FROM crawl_targets ct
  JOIN connectors c ON c.id = ct.connector_id
  WHERE ct.next_run_at <= %(now)s
    AND (ct.leased_until IS NULL OR ct.leased_until < %(now)s)
    AND c.enabled
    AND (NOT %(production)s OR c.legal_review = 'approved')
  ORDER BY ct.priority, ct.next_run_at
  LIMIT %(limit)s
  FOR UPDATE OF ct SKIP LOCKED
) due
WHERE t.id = due.id
RETURNING t.id, t.connector_id, t.target, t.entity_id, t.priority, t.failures
"""


def claim_due(
    conn: psycopg.Connection[Any], *, now: datetime, limit: int, lease_minutes: int, production: bool
) -> list[Target]:
    with conn.cursor(row_factory=class_row(Target)) as cur:
        cur.execute(
            CLAIM_SQL,
            {"now": now, "lease": now + timedelta(minutes=lease_minutes), "limit": limit, "production": production},
        )
        targets = sorted(cur.fetchall(), key=lambda t: (t.priority, t.id))
    conn.commit()
    return targets
