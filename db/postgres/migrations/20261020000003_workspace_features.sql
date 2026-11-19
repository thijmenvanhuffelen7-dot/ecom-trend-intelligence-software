-- migrate:up
CREATE TABLE watchlists (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type  entity_type NOT NULL,
  entity_id    bigint NOT NULL,
  added_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, entity_type, entity_id)
);

CREATE TABLE alert_rules (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  rule         jsonb NOT NULL,      -- gevalideerd met zod-schema in packages/core
  channels     jsonb NOT NULL DEFAULT '[]',
  enabled      boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id      uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL,
  read_at      timestamptz
);
CREATE INDEX alert_events_ws_idx ON alert_events (workspace_id, triggered_at DESC);

-- Row Level Security als vangnet: de app zet `app.workspace_id` per transactie.
-- De applicatielaag filtert al op workspace_id; dit voorkomt lekken bij een vergeten filter.
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON watchlists
  USING (workspace_id::text = current_setting('app.workspace_id', true));
CREATE POLICY tenant_isolation ON alert_rules
  USING (workspace_id::text = current_setting('app.workspace_id', true));
CREATE POLICY tenant_isolation ON alert_events
  USING (workspace_id::text = current_setting('app.workspace_id', true));
CREATE POLICY tenant_isolation ON api_keys
  USING (workspace_id::text = current_setting('app.workspace_id', true));

-- migrate:down
DROP TABLE alert_events, alert_rules, watchlists;
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_keys;
