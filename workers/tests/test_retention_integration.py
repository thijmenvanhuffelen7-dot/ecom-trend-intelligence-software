"""Integratie: bewaartermijnen. RUN_INTEGRATION=1."""

import os
import uuid
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not os.environ.get("RUN_INTEGRATION"), reason="zet RUN_INTEGRATION=1"),
]


def test_retention_deletes_only_expired_rows() -> None:
    from trendscope.core.settings import get_settings
    from trendscope.maintenance.retention import apply_retention

    now = datetime.now(UTC)
    with psycopg.connect(get_settings().database_url) as conn:
        wid = conn.execute(
            "INSERT INTO workspaces (name, slug) VALUES ('Ret', %s) RETURNING id", (f"ret-{uuid.uuid4().hex[:8]}",)
        ).fetchone()[0]
        old, new = "retention-old", "retention-new"
        conn.execute(
            "INSERT INTO audit_logs (workspace_id, action, created_at) VALUES (%s, %s, %s), (%s, %s, %s)",
            (wid, old, now - timedelta(days=400), wid, new, now - timedelta(days=10)),
        )
        conn.execute(
            """INSERT INTO workspace_invitations (workspace_id, email, token_hash, expires_at)
               VALUES (%s, 'a@x.dev', %s, %s), (%s, 'b@x.dev', %s, %s)""",
            (wid, uuid.uuid4().hex, now - timedelta(days=40), wid, uuid.uuid4().hex, now + timedelta(days=3)),
        )
        conn.commit()
        stats = apply_retention(conn, now)
        assert stats["audit_logs"] >= 1 and stats["workspace_invitations"] >= 1
        actions = {r[0] for r in conn.execute("SELECT action FROM audit_logs WHERE workspace_id = %s", (wid,))}
        assert actions == {new}
        emails = {r[0] for r in conn.execute("SELECT email FROM workspace_invitations WHERE workspace_id = %s", (wid,))}
        assert emails == {"b@x.dev"}
        conn.execute("DELETE FROM workspaces WHERE id = %s", (wid,))
        conn.commit()
