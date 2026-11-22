-- migrate:up
-- Fase 5: trenddetectie (keywords, hashtags, Reddit), live scoring, forecasts en backtests

ALTER TABLE keywords
  ADD COLUMN kind        text NOT NULL DEFAULT 'keyword' CHECK (kind IN ('keyword', 'hashtag')),
  ADD COLUMN first_seen  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN interest    real,             -- laatste zoekinteresse (index 0–100) of vermeldingen/dag (hashtags)
  ADD COLUMN growth_7d   real,             -- procent
  ADD COLUMN growth_30d  real,
  ADD COLUMN phase       trend_phase,
  ADD COLUMN peak_month  smallint CHECK (peak_month BETWEEN 1 AND 12),  -- seizoenspiek (alleen bij duidelijk seizoen)
  ADD COLUMN seasonality real,             -- 0–1: hoe sterk het seizoenspatroon is
  ADD COLUMN updated_at  timestamptz;
CREATE INDEX keywords_growth_idx ON keywords (kind, growth_7d DESC NULLS LAST);
CREATE INDEX keywords_term_trgm ON keywords USING gin (term gin_trgm_ops);

CREATE TABLE reddit_mentions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id     text NOT NULL UNIQUE,
  subreddit   text NOT NULL,
  keyword_id  bigint REFERENCES keywords(id) ON DELETE SET NULL,
  cluster_id  bigint REFERENCES product_clusters(id) ON DELETE SET NULL,
  title       text NOT NULL,
  url         text NOT NULL,
  score       integer NOT NULL DEFAULT 0,
  comments    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reddit_mentions_cluster_idx ON reddit_mentions (cluster_id, created_at DESC);
CREATE INDEX reddit_mentions_keyword_idx ON reddit_mentions (keyword_id, created_at DESC);

-- Live signalen sluiten aan op bestaande historie: één vaste factor per reeks, controleerbaar
CREATE TABLE signal_scales (
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  source      text NOT NULL,
  factor      real NOT NULL,
  basis       jsonb NOT NULL DEFAULT '{}',   -- {history_mean, first_live, date}
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, source)
);

CREATE TABLE forecasts (
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  source      text NOT NULL,                 -- 'demand' (clusters) of 'search' (keywords)
  computed_at timestamptz NOT NULL DEFAULT now(),
  method      text NOT NULL,
  points      jsonb NOT NULL,                -- [{d, v, lo, hi}] voor 90 dagen
  mape        real,                          -- backtest-fout op de laatste 14 dagen
  trend_30d   real,                          -- verwachte verandering over 30 dagen (procent)
  PRIMARY KEY (entity_type, entity_id, source)
);

CREATE TABLE backtests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at          timestamptz NOT NULL DEFAULT now(),
  cutoff          date NOT NULL,
  horizon_days    integer NOT NULL,
  weights_version integer NOT NULL REFERENCES score_weights(version),
  metrics         jsonb NOT NULL,            -- {spearman, precision_at_10, auc, n, base_rate}
  top             jsonb NOT NULL             -- de top-10 op de cutoff, met de latere uitkomst
);

-- migrate:down
DROP TABLE backtests;
DROP TABLE forecasts;
DROP TABLE signal_scales;
DROP TABLE reddit_mentions;
DROP INDEX IF EXISTS keywords_term_trgm;
DROP INDEX IF EXISTS keywords_growth_idx;
ALTER TABLE keywords
  DROP COLUMN kind, DROP COLUMN first_seen, DROP COLUMN interest, DROP COLUMN growth_7d, DROP COLUMN growth_30d,
  DROP COLUMN phase, DROP COLUMN peak_month, DROP COLUMN seasonality, DROP COLUMN updated_at;
