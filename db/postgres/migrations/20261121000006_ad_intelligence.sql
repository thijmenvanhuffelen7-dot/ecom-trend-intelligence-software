-- migrate:up
-- Fase 3: ad intelligence (Meta/TikTok/Google-connectors, koppeling, creatives, swipe-file)

ALTER TABLE ads
  ADD COLUMN source_connector    text,
  ADD COLUMN snapshot_url        text,               -- Meta: renderbare snapshot (vereist token)
  ADD COLUMN link_caption        text,               -- Meta: weergegeven domein onder de ad
  ADD COLUMN link_description    text,
  ADD COLUMN publisher_platforms text[] NOT NULL DEFAULT '{}',  -- facebook, instagram, messenger, audience_network
  ADD COLUMN creative_hash       text,               -- zelfde creative = varianten van elkaar
  ADD COLUMN eu_reach            bigint,             -- exact uit EU-transparantiedata (Meta)
  ADD COLUMN impressions_low     bigint,             -- Google: times_shown-bandbreedte
  ADD COLUMN impressions_high    bigint,
  ADD COLUMN media               jsonb NOT NULL DEFAULT '[]',   -- [{type, url, storage_key, width, height}]
  ADD COLUMN target_ages         text,
  ADD COLUMN target_gender       text,
  ADD COLUMN landing_domain      text,
  ADD COLUMN content_hash        text;
CREATE INDEX ads_creative_hash_idx ON ads (advertiser_id, creative_hash);
CREATE INDEX ads_landing_domain_idx ON ads (landing_domain);
CREATE INDEX ads_platform_start_idx ON ads (platform, start_date DESC);

ALTER TABLE advertisers
  ADD COLUMN page_url        text,
  ADD COLUMN avatar_url      text,
  ADD COLUMN country         char(2),
  ADD COLUMN verified        boolean,
  ADD COLUMN first_ad_at     date,
  ADD COLUMN active_ads      integer NOT NULL DEFAULT 0,
  ADD COLUMN total_ads       integer NOT NULL DEFAULT 0,
  ADD COLUMN eu_reach_total  bigint NOT NULL DEFAULT 0,
  ADD COLUMN new_ads_7d      integer NOT NULL DEFAULT 0,
  ADD COLUMN last_crawled    timestamptz;
CREATE INDEX advertisers_store_idx ON advertisers (store_id);
CREATE INDEX advertisers_name_trgm_idx ON advertisers USING gin (name gin_trgm_ops);

-- Opgeslagen media (content-addressed in S3; dezelfde afbeelding wordt één keer opgeslagen)
CREATE TABLE creative_assets (
  sha256       char(64) PRIMARY KEY,
  storage_key  text NOT NULL,
  content_type text NOT NULL,
  bytes        integer NOT NULL,
  width        integer,
  height       integer,
  source_url   text,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- Swipe-file: boards per workspace
CREATE TABLE boards (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  color        text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boards_ws_idx ON boards (workspace_id, updated_at DESC);

CREATE TABLE board_items (
  board_id    uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  note        text,
  tags        text[] NOT NULL DEFAULT '{}',
  added_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, entity_type, entity_id)
);
CREATE INDEX board_items_entity_idx ON board_items (entity_type, entity_id);

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON boards USING (workspace_id::text = current_setting('app.workspace_id', true));

-- migrate:down
DROP POLICY IF EXISTS tenant_isolation ON boards;
DROP TABLE board_items, boards, creative_assets;
DROP INDEX IF EXISTS advertisers_name_trgm_idx;
DROP INDEX IF EXISTS advertisers_store_idx;
ALTER TABLE advertisers
  DROP COLUMN page_url, DROP COLUMN avatar_url, DROP COLUMN country, DROP COLUMN verified, DROP COLUMN first_ad_at,
  DROP COLUMN active_ads, DROP COLUMN total_ads, DROP COLUMN eu_reach_total, DROP COLUMN new_ads_7d, DROP COLUMN last_crawled;
DROP INDEX IF EXISTS ads_platform_start_idx;
DROP INDEX IF EXISTS ads_landing_domain_idx;
DROP INDEX IF EXISTS ads_creative_hash_idx;
ALTER TABLE ads
  DROP COLUMN source_connector, DROP COLUMN snapshot_url, DROP COLUMN link_caption, DROP COLUMN link_description,
  DROP COLUMN publisher_platforms, DROP COLUMN creative_hash, DROP COLUMN eu_reach, DROP COLUMN impressions_low,
  DROP COLUMN impressions_high, DROP COLUMN media, DROP COLUMN target_ages, DROP COLUMN target_gender,
  DROP COLUMN landing_domain, DROP COLUMN content_hash;
