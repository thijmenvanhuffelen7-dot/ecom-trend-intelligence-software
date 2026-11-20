-- migrate:up
-- Fase 2: store intelligence (crawler, diff-detectie, discovery, freshness)

-- Huidige productstaat, zodat de crawler kan diffen zonder ClickHouse te bevragen
ALTER TABLE products
  ADD COLUMN handle           text,
  ADD COLUMN compare_at_price numeric(12, 2),
  ADD COLUMN available        boolean NOT NULL DEFAULT true,
  ADD COLUMN variants         jsonb NOT NULL DEFAULT '[]',   -- [{id, title, price, available}]
  ADD COLUMN published_at     timestamptz,
  ADD COLUMN removed_at       timestamptz;
CREATE INDEX products_store_status_idx ON products (store_id, status);

ALTER TABLE stores
  ADD COLUMN shopify_domain     text,            -- <naam>.myshopify.com
  ADD COLUMN data_source        text NOT NULL DEFAULT 'seed' CHECK (data_source IN ('seed', 'crawl')),
  ADD COLUMN bestseller_source  text,            -- bv. 'collection:best-sellers'
  ADD COLUMN products_added_7d  integer NOT NULL DEFAULT 0,
  ADD COLUMN products_removed_7d integer NOT NULL DEFAULT 0,
  ADD COLUMN price_changes_7d   integer NOT NULL DEFAULT 0,
  ADD COLUMN last_change_at     timestamptz;

ALTER TABLE crawl_targets
  ADD COLUMN last_run_at  timestamptz,
  ADD COLUMN last_status  text,
  ADD COLUMN leased_until timestamptz;           -- voorkomt dubbele uitvoering door meerdere schedulers

ALTER TABLE crawl_jobs
  ADD COLUMN target_id    bigint REFERENCES crawl_targets(id) ON DELETE SET NULL,
  ADD COLUMN attempt      integer NOT NULL DEFAULT 1,
  ADD COLUMN dead_letter  boolean NOT NULL DEFAULT false,
  ADD COLUMN stats        jsonb NOT NULL DEFAULT '{}';
CREATE INDEX crawl_jobs_status_idx ON crawl_jobs (status, started_at DESC);
CREATE INDEX crawl_jobs_dead_idx ON crawl_jobs (started_at DESC) WHERE dead_letter;

-- Discovery: kandidaat-domeinen uit CT-logs, ad-landingspagina's en imports
CREATE TABLE store_candidates (
  domain       text PRIMARY KEY,
  source       text NOT NULL,                     -- ct_logs | ads_landing | import | manual
  discovered_at timestamptz NOT NULL DEFAULT now(),
  probed_at    timestamptz,
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected', 'error')),
  platform     store_platform,
  store_id     bigint REFERENCES stores(id) ON DELETE SET NULL,
  evidence     jsonb NOT NULL DEFAULT '{}',
  attempts     integer NOT NULL DEFAULT 0
);
CREATE INDEX store_candidates_new_idx ON store_candidates (discovered_at) WHERE status = 'new';

-- migrate:down
DROP TABLE store_candidates;
DROP INDEX IF EXISTS crawl_jobs_dead_idx;
DROP INDEX IF EXISTS crawl_jobs_status_idx;
ALTER TABLE crawl_jobs DROP COLUMN target_id, DROP COLUMN attempt, DROP COLUMN dead_letter, DROP COLUMN stats;
ALTER TABLE crawl_targets DROP COLUMN last_run_at, DROP COLUMN last_status, DROP COLUMN leased_until;
ALTER TABLE stores
  DROP COLUMN shopify_domain, DROP COLUMN data_source, DROP COLUMN bestseller_source, DROP COLUMN products_added_7d,
  DROP COLUMN products_removed_7d, DROP COLUMN price_changes_7d, DROP COLUMN last_change_at;
DROP INDEX IF EXISTS products_store_status_idx;
ALTER TABLE products
  DROP COLUMN handle, DROP COLUMN compare_at_price, DROP COLUMN available, DROP COLUMN variants,
  DROP COLUMN published_at, DROP COLUMN removed_at;
