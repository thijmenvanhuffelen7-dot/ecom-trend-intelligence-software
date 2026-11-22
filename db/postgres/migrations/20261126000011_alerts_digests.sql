-- migrate:up
-- Fase 8: alertregels, kanalen (Slack, Discord, Telegram, webhook, e-mail), bezorging met retries en digests

CREATE TABLE notification_channels (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('email', 'slack', 'discord', 'telegram', 'webhook')),
  name         text NOT NULL,
  config_enc   text NOT NULL,     -- AES-256-GCM (APP_ENCRYPTION_KEY): webhook-URL, bot-token, secret … nooit in platte tekst
  target_hint  text NOT NULL,     -- gemaskeerd voor de UI, bv. "hooks.slack.com/…/9fA2"
  enabled      boolean NOT NULL DEFAULT true,
  last_error   text,
  last_used_at timestamptz,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_channels_ws_idx ON notification_channels (workspace_id);
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_channels
  USING (workspace_id::text = current_setting('app.workspace_id', true));

ALTER TABLE alert_rules
  ADD COLUMN cooldown_hours    integer NOT NULL DEFAULT 24 CHECK (cooldown_hours BETWEEN 1 AND 720),
  ADD COLUMN last_evaluated_at timestamptz,
  ADD COLUMN last_triggered_at timestamptz;

ALTER TABLE alert_events
  ADD COLUMN dedupe_key  text,           -- entiteit + tijdvak: dezelfde melding komt niet twee keer binnen de cooldown
  ADD COLUMN entity_type entity_type,
  ADD COLUMN entity_id   bigint,
  ADD COLUMN title       text;
CREATE UNIQUE INDEX alert_events_dedupe_uniq ON alert_events (rule_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX alert_events_unread_idx ON alert_events (workspace_id) WHERE read_at IS NULL;

CREATE TABLE alert_deliveries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        bigint NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  channel_id      uuid REFERENCES notification_channels(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  sent_at         timestamptz
);
CREATE INDEX alert_deliveries_due_idx ON alert_deliveries (next_attempt_at) WHERE status = 'pending';

ALTER TABLE users
  ADD COLUMN digest           text NOT NULL DEFAULT 'weekly' CHECK (digest IN ('off', 'daily', 'weekly')),
  ADD COLUMN digest_last_sent timestamptz;

-- Uitgaande e-mail (digests, e-mailalerts). Zonder RESEND_API_KEY blijft het hier staan (zichtbaar in admin/dev).
CREATE TABLE outbound_emails (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_address  text NOT NULL,
  subject     text NOT NULL,
  html        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('digest', 'alert', 'system')),
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'logged', 'failed')),
  provider_id text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

-- migrate:down
DROP TABLE outbound_emails;
ALTER TABLE users DROP COLUMN digest, DROP COLUMN digest_last_sent;
DROP TABLE alert_deliveries;
DROP INDEX IF EXISTS alert_events_unread_idx;
DROP INDEX IF EXISTS alert_events_dedupe_uniq;
ALTER TABLE alert_events DROP COLUMN dedupe_key, DROP COLUMN entity_type, DROP COLUMN entity_id, DROP COLUMN title;
ALTER TABLE alert_rules DROP COLUMN cooldown_hours, DROP COLUMN last_evaluated_at, DROP COLUMN last_triggered_at;
DROP TABLE notification_channels;
