-- migrate:up
-- Fase 11: publieke API (rate limiting), push-to-store (Shopify) en de Chrome-extensie

-- Vaste vensters van één minuut per API-sleutel. UNLOGGED: tellers hoeven een crash niet te overleven.
CREATE UNLOGGED TABLE api_rate_windows (
  key_id       uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, window_start)
);

-- Gekoppelde eigen winkels (nu: Shopify custom app). Het token staat versleuteld (AES-256-GCM, APP_ENCRYPTION_KEY).
CREATE TABLE shop_connections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'shopify' CHECK (provider IN ('shopify')),
  shop_domain  text NOT NULL CHECK (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  token_enc    text NOT NULL,
  shop_name    text,
  mode         text NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'mock')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  last_error   text,
  UNIQUE (workspace_id, shop_domain)
);
ALTER TABLE shop_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shop_connections USING (workspace_id::text = current_setting('app.workspace_id', true));

-- Elk product dat iemand naar zijn winkel stuurt (altijd als concept), met het resultaat
CREATE TABLE store_pushes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id     uuid NOT NULL REFERENCES shop_connections(id) ON DELETE CASCADE,
  cluster_id        bigint NOT NULL REFERENCES product_clusters(id) ON DELETE CASCADE,
  status            text NOT NULL CHECK (status IN ('created', 'failed')),
  remote_product_id text,
  remote_admin_url  text,
  payload           jsonb NOT NULL DEFAULT '{}',
  error             text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_pushes_ws_idx ON store_pushes (workspace_id, created_at DESC);
ALTER TABLE store_pushes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_pushes USING (workspace_id::text = current_setting('app.workspace_id', true));

-- migrate:down
DROP TABLE store_pushes;
DROP TABLE shop_connections;
DROP TABLE api_rate_windows;
