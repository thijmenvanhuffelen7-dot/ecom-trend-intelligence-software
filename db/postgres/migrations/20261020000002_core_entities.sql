-- migrate:up
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE store_platform AS ENUM ('shopify', 'woocommerce', 'magento', 'bigcommerce', 'wix', 'tiktok_shop', 'amazon', 'other', 'unknown');
CREATE TYPE product_source AS ENUM ('shopify', 'woocommerce', 'tiktok_shop', 'aliexpress', 'amazon', 'cj', 'temu', 'alibaba', 'etsy');
CREATE TYPE ad_platform AS ENUM ('meta', 'tiktok', 'google', 'pinterest', 'snapchat', 'youtube');
CREATE TYPE social_platform AS ENUM ('tiktok', 'instagram', 'youtube');
CREATE TYPE entity_type AS ENUM ('product_cluster', 'product', 'store', 'ad', 'advertiser', 'creator', 'video', 'keyword', 'niche');
CREATE TYPE trend_phase AS ENUM ('emerging', 'rising', 'peak', 'saturated', 'declining');

CREATE TABLE niches (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name_nl    text NOT NULL,
  name_en    text NOT NULL,
  parent_id  bigint REFERENCES niches(id)
);

CREATE TABLE stores (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain        text NOT NULL UNIQUE,
  platform      store_platform NOT NULL DEFAULT 'unknown',
  name          text,
  description   text,
  country       char(2),
  currency      char(3),
  languages     text[] NOT NULL DEFAULT '{}',
  theme         text,
  niche_id      bigint REFERENCES niches(id),
  social        jsonb NOT NULL DEFAULT '{}',
  launched_at   date,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_crawled  timestamptz,
  product_count integer NOT NULL DEFAULT 0,
  est_revenue   jsonb,   -- Estimate: {value, low, high, confidence, method, currency}
  est_traffic   jsonb,   -- Estimate
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX stores_platform_country_idx ON stores (platform, country);
CREATE INDEX stores_first_seen_idx ON stores (first_seen DESC);
CREATE INDEX stores_name_trgm_idx ON stores USING gin ((coalesce(name, '') || ' ' || domain) gin_trgm_ops);

CREATE TABLE store_technologies (
  store_id    bigint NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('app', 'pixel', 'payment', 'email', 'reviews', 'theme', 'analytics', 'other')),
  name        text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz,
  PRIMARY KEY (store_id, type, name)
);
CREATE INDEX store_tech_name_idx ON store_technologies (type, name);

CREATE TABLE product_clusters (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_title text NOT NULL,
  slug            text NOT NULL UNIQUE,
  niche_id        bigint REFERENCES niches(id),
  category        text,
  keywords        text[] NOT NULL DEFAULT '{}',
  image_url       text,
  min_price       numeric(12, 2),
  max_price       numeric(12, 2),
  currency        char(3) NOT NULL DEFAULT 'EUR',
  store_count     integer NOT NULL DEFAULT 0,
  ad_count        integer NOT NULL DEFAULT 0,
  creator_count   integer NOT NULL DEFAULT 0,
  ai_insights     jsonb,
  embedding       vector(512),
  first_seen      timestamptz NOT NULL DEFAULT now(),
  is_curated      boolean NOT NULL DEFAULT false
);
CREATE INDEX clusters_niche_idx ON product_clusters (niche_id);
CREATE INDEX clusters_title_trgm_idx ON product_clusters USING gin (canonical_title gin_trgm_ops);
CREATE INDEX clusters_embedding_idx ON product_clusters USING hnsw (embedding vector_cosine_ops);

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      product_source NOT NULL,
  store_id    bigint REFERENCES stores(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  url         text,
  title       text NOT NULL,
  vendor      text,
  category    text,
  tags        text[] NOT NULL DEFAULT '{}',
  images      text[] NOT NULL DEFAULT '{}',
  price       numeric(12, 2),
  currency    char(3),
  content_hash text,                         -- voor wijzigingsdetectie: snapshot alleen bij nieuwe hash
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'out_of_stock')),
  UNIQUE (source, store_id, external_id)
);
CREATE INDEX products_store_idx ON products (store_id, first_seen DESC);

CREATE TABLE cluster_members (
  cluster_id bigint NOT NULL REFERENCES product_clusters(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  confidence real NOT NULL,
  method     text NOT NULL DEFAULT 'manual',  -- title | phash | embedding | manual
  PRIMARY KEY (cluster_id, product_id)
);
CREATE UNIQUE INDEX cluster_members_product_idx ON cluster_members (product_id);

CREATE TABLE suppliers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      product_source NOT NULL,
  external_id text NOT NULL,
  name        text NOT NULL,
  rating      real,
  url         text,
  UNIQUE (source, external_id)
);

CREATE TABLE supplier_offers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id   bigint NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  cluster_id    bigint NOT NULL REFERENCES product_clusters(id) ON DELETE CASCADE,
  url           text,
  price         numeric(12, 2) NOT NULL,
  shipping_cost numeric(12, 2) NOT NULL DEFAULT 0,
  shipping_days int4range,
  currency      char(3) NOT NULL DEFAULT 'USD',
  orders        integer,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_offers_cluster_idx ON supplier_offers (cluster_id);

CREATE TABLE advertisers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform    ad_platform NOT NULL,
  external_id text NOT NULL,
  name        text NOT NULL,
  store_id    bigint REFERENCES stores(id) ON DELETE SET NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE TABLE ads (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform       ad_platform NOT NULL,
  external_id    text NOT NULL,
  advertiser_id  bigint REFERENCES advertisers(id) ON DELETE CASCADE,
  format         text CHECK (format IN ('image', 'video', 'carousel', 'text', 'other')),
  body           text,
  headline       text,
  cta            text,
  media_urls     text[] NOT NULL DEFAULT '{}',
  thumbnail_url  text,
  transcript     text,
  ocr_text       text,
  landing_url    text,
  countries      char(2)[] NOT NULL DEFAULT '{}',
  languages      text[] NOT NULL DEFAULT '{}',
  start_date     date,
  end_date       date,
  is_active      boolean NOT NULL DEFAULT true,
  variants_count integer NOT NULL DEFAULT 1,
  est_spend      jsonb,   -- Estimate
  est_reach      jsonb,   -- Estimate
  first_seen     timestamptz NOT NULL DEFAULT now(),
  last_seen      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);
CREATE INDEX ads_advertiser_idx ON ads (advertiser_id);
CREATE INDEX ads_active_start_idx ON ads (is_active, start_date DESC);

CREATE TABLE creators (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform        social_platform NOT NULL,
  handle          text NOT NULL,
  display_name    text,
  avatar_url      text,
  followers       integer,
  engagement_rate real,
  niches          text[] NOT NULL DEFAULT '{}',
  contact_public  jsonb,   -- alleen publiek gepubliceerde zakelijke contactgegevens (AVG)
  est_gmv         jsonb,   -- Estimate
  first_seen      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, handle)
);

CREATE TABLE videos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform    social_platform NOT NULL,
  external_id text NOT NULL,
  creator_id  bigint REFERENCES creators(id) ON DELETE CASCADE,
  url         text,
  caption     text,
  hashtags    text[] NOT NULL DEFAULT '{}',
  sound       text,
  thumbnail_url text,
  posted_at   timestamptz,
  views       bigint,
  likes       bigint,
  UNIQUE (platform, external_id)
);

CREATE TABLE keywords (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term     text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  niche_id bigint REFERENCES niches(id),
  UNIQUE (term, language)
);

-- Kern-differentiator: generieke koppelingen tussen alle entiteiten, met bewijs.
CREATE TABLE entity_links (
  from_type   entity_type NOT NULL,
  from_id     bigint NOT NULL,
  to_type     entity_type NOT NULL,
  to_id       bigint NOT NULL,
  link_type   text NOT NULL,          -- sells | advertises | promotes | searched_as | landing_page | supplies
  confidence  real NOT NULL DEFAULT 1,
  evidence    jsonb NOT NULL DEFAULT '{}',
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_type, from_id, to_type, to_id, link_type)
);
CREATE INDEX entity_links_reverse_idx ON entity_links (to_type, to_id, from_type);

-- Versiebeheerde scoregewichten: elke score bewaart de gebruikte versie (reproduceerbare backtests).
CREATE TABLE score_weights (
  version    integer PRIMARY KEY,
  weights    jsonb NOT NULL,
  params     jsonb NOT NULL DEFAULT '{}',
  is_active  boolean NOT NULL DEFAULT false,
  note       text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX score_weights_one_active ON score_weights (is_active) WHERE is_active;

-- Laatste score per entiteit; historie staat in ClickHouse (score_history).
CREATE TABLE scores (
  entity_type     entity_type NOT NULL,
  entity_id       bigint NOT NULL,
  date            date NOT NULL,
  growth_velocity real NOT NULL,
  validation      real NOT NULL,
  saturation      real NOT NULL,
  opportunity     real NOT NULL,
  phase           trend_phase NOT NULL,
  breakdown       jsonb NOT NULL,
  weights_version integer NOT NULL REFERENCES score_weights(version),
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX scores_opportunity_idx ON scores (entity_type, opportunity DESC);
CREATE INDEX scores_validation_idx ON scores (entity_type, validation DESC);

-- Connectors en crawling
CREATE TABLE connectors (
  id              text PRIMARY KEY,
  display_name    text NOT NULL,
  kind            text NOT NULL,
  enabled         boolean NOT NULL DEFAULT false,
  legal_review    text NOT NULL DEFAULT 'pending' CHECK (legal_review IN ('pending', 'approved', 'rejected')),
  freshness_sla_hours integer NOT NULL DEFAULT 24,
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crawl_targets (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connector_id  text NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  target        text NOT NULL,                  -- domein, URL of externe id
  entity_type   entity_type,
  entity_id     bigint,
  priority      smallint NOT NULL DEFAULT 50,   -- 0 = hoogst
  interval_secs integer NOT NULL DEFAULT 86400,
  next_run_at   timestamptz NOT NULL DEFAULT now(),
  etag          text,
  last_modified text,
  content_hash  text,
  failures      integer NOT NULL DEFAULT 0,
  UNIQUE (connector_id, target)
);
CREATE INDEX crawl_targets_due_idx ON crawl_targets (next_run_at, priority);

CREATE TABLE crawl_jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connector_id text NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  target       text,
  status       text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  duration_ms  integer,
  items        integer NOT NULL DEFAULT 0,
  error        text
);
CREATE INDEX crawl_jobs_connector_idx ON crawl_jobs (connector_id, started_at DESC);

-- migrate:down
DROP TABLE crawl_jobs, crawl_targets, connectors, scores, score_weights, entity_links, keywords, videos, creators,
  ads, advertisers, supplier_offers, suppliers, cluster_members, products, product_clusters, store_technologies, stores, niches;
DROP TYPE trend_phase, entity_type, social_platform, ad_platform, product_source, store_platform;
