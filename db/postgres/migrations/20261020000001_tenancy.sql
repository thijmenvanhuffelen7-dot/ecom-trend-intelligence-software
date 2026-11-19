-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- uuid v7: tijd-sorteerbaar, goed voor indexen op tenant-tabellen
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
DECLARE
  ts_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b bytea := gen_random_bytes(16);
BEGIN
  b := set_byte(b, 0, ((ts_ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((ts_ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((ts_ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((ts_ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((ts_ms >> 8) & 255)::int);
  b := set_byte(b, 5, (ts_ms & 255)::int);
  b := set_byte(b, 6, ((get_byte(b, 6) & 15) | 112));
  b := set_byte(b, 8, ((get_byte(b, 8) & 63) | 128));
  RETURN encode(b, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;

CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE plan_id AS ENUM ('free', 'starter', 'pro', 'business');
CREATE TYPE user_persona AS ENUM ('dropshipper', 'brand', 'agency', 'investor', 'other');

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  auth_provider_id text UNIQUE,              -- Clerk user id, of 'dev:<email>' in dev-auth
  email            text NOT NULL UNIQUE,
  name             text,
  locale           text NOT NULL DEFAULT 'nl',
  persona          user_persona,
  is_platform_admin boolean NOT NULL DEFAULT false,
  onboarded_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  auth_provider_id text UNIQUE,              -- Clerk organization id
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  plan             plan_id NOT NULL DEFAULT 'free',
  trial_ends_at    timestamptz,
  niches           text[] NOT NULL DEFAULT '{}',
  countries        text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'member',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT uuid_v7(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,
  plan                   plan_id NOT NULL,
  interval               text NOT NULL CHECK (interval IN ('month', 'year')),
  status                 text NOT NULL,
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usage_counters (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feature      text NOT NULL,
  period_start date NOT NULL,
  used         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, feature, period_start)
);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,         -- zichtbaar deel, bv. 'ts_live_ab12cd'
  key_hash     text NOT NULL,                -- sha256 van de volledige key
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_ws_idx ON audit_logs (workspace_id, created_at DESC);

CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  description text,
  rollout     jsonb NOT NULL DEFAULT '{}',   -- bv. {"workspaces": [...], "plans": ["pro"]}
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE feature_flags, audit_logs, api_keys, usage_counters, subscriptions, memberships, workspaces, users;
DROP TYPE user_persona, plan_id, workspace_role;
DROP FUNCTION uuid_v7();
