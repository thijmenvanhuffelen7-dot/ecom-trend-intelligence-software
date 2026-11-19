-- Dagelijkse winkelmetrics. metric: visits | live_ads | ads_launched | followers_instagram | followers_tiktok | ...
CREATE TABLE IF NOT EXISTS store_metrics_daily
(
    store_id UInt64,
    metric   LowCardinality(String),
    date     Date,
    value    Float64
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (store_id, metric, date)
;
