-- migrate:up
-- Fase 10: Stripe-billing (abonnementen, trial, facturen met btw), idempotente webhooks, admin

ALTER TABLE workspaces
  ADD COLUMN stripe_customer_id text UNIQUE,
  ADD COLUMN trial_used         boolean NOT NULL DEFAULT false,
  ADD COLUMN billing_status     text NOT NULL DEFAULT 'none'
    CHECK (billing_status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'demo'));

ALTER TABLE subscriptions
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN trial_end            timestamptz,
  ADD COLUMN price_id             text;
CREATE INDEX subscriptions_ws_idx ON subscriptions (workspace_id, updated_at DESC);

-- Stripe stuurt events soms dubbel of in een andere volgorde: we verwerken elk event precies één keer
CREATE TABLE stripe_events (
  id           text PRIMARY KEY,           -- evt_…
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text
);

CREATE TABLE invoices (
  id                text PRIMARY KEY,      -- in_… (Stripe) of demo_…
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number            text,
  status            text NOT NULL,          -- draft | open | paid | void | uncollectible
  currency          text NOT NULL DEFAULT 'eur',
  amount_due        integer NOT NULL,       -- in centen
  amount_paid       integer NOT NULL DEFAULT 0,
  tax               integer,                -- btw in centen (Stripe Tax)
  hosted_invoice_url text,
  invoice_pdf       text,
  period_start      timestamptz,
  period_end        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_ws_idx ON invoices (workspace_id, created_at DESC);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices USING (workspace_id::text = current_setting('app.workspace_id', true));

-- migrate:down
DROP TABLE invoices;
DROP TABLE stripe_events;
DROP INDEX IF EXISTS subscriptions_ws_idx;
ALTER TABLE subscriptions DROP COLUMN cancel_at_period_end, DROP COLUMN trial_end, DROP COLUMN price_id;
ALTER TABLE workspaces DROP COLUMN stripe_customer_id, DROP COLUMN trial_used, DROP COLUMN billing_status;
