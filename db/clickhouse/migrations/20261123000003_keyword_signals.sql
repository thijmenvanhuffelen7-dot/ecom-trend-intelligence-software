-- Zoekinteresse en vermeldingen per keyword, per land en dag (Google Trends-index 0–100, Reddit-posts, hashtaggebruik)

CREATE TABLE IF NOT EXISTS keyword_signals_daily
(
    keyword_id UInt64,
    source     LowCardinality(String),
    country    LowCardinality(String),
    date       Date,
    value      Float64,
    updated_at DateTime('UTC') DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(date)
ORDER BY (keyword_id, source, country, date)
;
