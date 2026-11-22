-- migrate:up
-- Fase 6: TikTok Shop, creators, video's en livestreams

ALTER TABLE creators
  ADD COLUMN external_id        text,            -- platform-id (kanaal-id, user-id)
  ADD COLUMN country            char(2),
  ADD COLUMN bio                text,
  ADD COLUMN followers_growth_7d real,           -- procent
  ADD COLUMN avg_views          integer,          -- gemiddelde over recente video's
  ADD COLUMN videos_count       integer,
  ADD COLUMN gmv_30d            jsonb,            -- Estimate: verkopen via eigen video's/lives (30 dagen)
  ADD COLUMN last_crawled       timestamptz;
CREATE INDEX creators_followers_idx ON creators (platform, followers DESC NULLS LAST);

ALTER TABLE videos
  ADD COLUMN comments     bigint,
  ADD COLUMN shares       bigint,
  ADD COLUMN views_24h    bigint,                 -- groei laatste 24 uur
  ADD COLUMN product_id   bigint REFERENCES products(id) ON DELETE SET NULL,  -- productanker in de video (TikTok Shop)
  ADD COLUMN last_crawled timestamptz;
CREATE INDEX videos_posted_idx ON videos (platform, posted_at DESC);
CREATE INDEX videos_creator_idx ON videos (creator_id, posted_at DESC);

CREATE TABLE tiktok_shops (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id  text NOT NULL UNIQUE,
  name         text NOT NULL,
  country      char(2),
  rating       real,
  followers    integer,
  product_count integer NOT NULL DEFAULT 0,
  sold_30d     integer,                            -- door TikTok getoonde verkopen (afgeleid uit tellerstanden)
  gmv_30d      jsonb,                              -- Estimate
  store_id     bigint REFERENCES stores(id) ON DELETE SET NULL,  -- dezelfde merknaam als een webshop
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_crawled timestamptz
);

ALTER TABLE products
  ADD COLUMN tiktok_shop_id  bigint REFERENCES tiktok_shops(id) ON DELETE CASCADE,
  ADD COLUMN sold_count      integer,             -- cumulatieve teller op de productpagina
  ADD COLUMN commission_rate real;                -- affiliatecommissie voor creators (0–1)
CREATE INDEX products_tiktok_shop_idx ON products (tiktok_shop_id) WHERE tiktok_shop_id IS NOT NULL;

CREATE TABLE livestreams (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id    text NOT NULL UNIQUE,
  creator_id     bigint REFERENCES creators(id) ON DELETE CASCADE,
  tiktok_shop_id bigint REFERENCES tiktok_shops(id) ON DELETE SET NULL,
  title          text,
  started_at     timestamptz NOT NULL,
  duration_min   integer,
  peak_viewers   integer,
  total_viewers  integer,
  units_sold     integer,                          -- som van de tellerstijging tijdens de live
  gmv            jsonb,                            -- Estimate
  status         text NOT NULL DEFAULT 'ended' CHECK (status IN ('live', 'ended'))
);
CREATE INDEX livestreams_started_idx ON livestreams (started_at DESC);

CREATE TABLE livestream_products (
  livestream_id bigint NOT NULL REFERENCES livestreams(id) ON DELETE CASCADE,
  product_id    bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  units_sold    integer,
  PRIMARY KEY (livestream_id, product_id)
);

-- migrate:down
DROP TABLE livestream_products;
DROP TABLE livestreams;
DROP INDEX IF EXISTS products_tiktok_shop_idx;
ALTER TABLE products DROP COLUMN tiktok_shop_id, DROP COLUMN sold_count, DROP COLUMN commission_rate;
DROP TABLE tiktok_shops;
DROP INDEX IF EXISTS videos_creator_idx;
DROP INDEX IF EXISTS videos_posted_idx;
ALTER TABLE videos DROP COLUMN comments, DROP COLUMN shares, DROP COLUMN views_24h, DROP COLUMN product_id, DROP COLUMN last_crawled;
DROP INDEX IF EXISTS creators_followers_idx;
ALTER TABLE creators
  DROP COLUMN external_id, DROP COLUMN country, DROP COLUMN bio, DROP COLUMN followers_growth_7d, DROP COLUMN avg_views,
  DROP COLUMN videos_count, DROP COLUMN gmv_30d, DROP COLUMN last_crawled;
