-- migrate:up
-- Gedenormaliseerde "laatste stand" per winkel voor snelle explorer-tabellen.
-- De historie staat in ClickHouse (store_metrics_daily); deze kolommen worden dagelijks bijgewerkt.
ALTER TABLE stores
  ADD COLUMN monthly_visits     integer,          -- schatting
  ADD COLUMN visits_growth      real,             -- % t.o.v. vorige maand
  ADD COLUMN live_ads           integer NOT NULL DEFAULT 0,
  ADD COLUMN ads_growth_30d     real,
  ADD COLUMN ads_launched_total integer NOT NULL DEFAULT 0,
  ADD COLUMN visitor_countries  jsonb NOT NULL DEFAULT '[]',  -- [{country, share, visits}]
  ADD COLUMN traffic_sources    jsonb NOT NULL DEFAULT '{}',  -- {direct, organic_search, paid_search, referral, social, ads, mail}
  ADD COLUMN social_followers   jsonb NOT NULL DEFAULT '{}',  -- {instagram, facebook, tiktok, youtube, pinterest}
  ADD COLUMN trustpilot         jsonb,                        -- {score, reviews}
  ADD COLUMN screenshot_url     text,
  ADD COLUMN brand_color        text;

CREATE INDEX stores_visits_idx ON stores (monthly_visits DESC NULLS LAST);
CREATE INDEX stores_live_ads_idx ON stores (live_ads DESC);

ALTER TABLE products ADD COLUMN best_seller_rank integer;   -- positie in collectie "best-selling"
CREATE INDEX products_bestseller_idx ON products (store_id, best_seller_rank) WHERE best_seller_rank IS NOT NULL;

-- Gecureerde lijsten / opgeslagen weergaven (Weekly Gems, Top Scaling, ...)
CREATE TABLE curated_lists (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  entity_type entity_type NOT NULL,
  name_nl     text NOT NULL,
  name_en     text NOT NULL,
  icon        text,
  position    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE curated_list_items (
  list_id   bigint NOT NULL REFERENCES curated_lists(id) ON DELETE CASCADE,
  entity_id bigint NOT NULL,
  position  integer NOT NULL DEFAULT 0,
  note      text,
  PRIMARY KEY (list_id, entity_id)
);

-- migrate:down
DROP TABLE curated_list_items, curated_lists;
ALTER TABLE products DROP COLUMN best_seller_rank;
ALTER TABLE stores
  DROP COLUMN monthly_visits, DROP COLUMN visits_growth, DROP COLUMN live_ads, DROP COLUMN ads_growth_30d,
  DROP COLUMN ads_launched_total, DROP COLUMN visitor_countries, DROP COLUMN traffic_sources,
  DROP COLUMN social_followers, DROP COLUMN trustpilot, DROP COLUMN screenshot_url, DROP COLUMN brand_color;
