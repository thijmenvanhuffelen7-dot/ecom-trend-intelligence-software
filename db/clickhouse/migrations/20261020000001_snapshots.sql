-- Append-only tijdreeksen. Snapshots worden alleen geschreven bij een gewijzigde content-hash.
-- Statements worden gescheiden door een regel met alleen ';' (zie workers/trendscope_core/clickhouse_migrate.py).

CREATE TABLE IF NOT EXISTS product_snapshots
(
    product_id       UInt64,
    captured_at      DateTime('UTC'),
    price            Nullable(Decimal(12, 2)),
    compare_at_price Nullable(Decimal(12, 2)),
    currency         LowCardinality(String),
    orders           Nullable(UInt64),
    reviews_count    Nullable(UInt32),
    rating           Nullable(Float32),
    stock            Nullable(Int32),
    variants_count   UInt16 DEFAULT 1,
    available        UInt8 DEFAULT 1
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (product_id, captured_at)
;

CREATE TABLE IF NOT EXISTS ad_snapshots
(
    ad_id          UInt64,
    captured_at    DateTime('UTC'),
    is_active      UInt8,
    variants_count UInt16,
    likes          Nullable(UInt64),
    comments       Nullable(UInt64),
    shares         Nullable(UInt64),
    views          Nullable(UInt64)
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (ad_id, captured_at)
;

CREATE TABLE IF NOT EXISTS creator_snapshots
(
    creator_id  UInt64,
    captured_at DateTime('UTC'),
    followers   UInt64,
    avg_views   Nullable(UInt64)
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (creator_id, captured_at)
;

CREATE TABLE IF NOT EXISTS video_snapshots
(
    video_id    UInt64,
    captured_at DateTime('UTC'),
    views       UInt64,
    likes       UInt64,
    shares      UInt64,
    comments    UInt64
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (video_id, captured_at)
;

-- Signaalwaarden per entiteit per dag: de input van de scoring-engine.
-- source: store | ads | social | tiktokshop | marketplace | search | reddit | price
CREATE TABLE IF NOT EXISTS entity_signals_daily
(
    entity_type LowCardinality(String),
    entity_id   UInt64,
    source      LowCardinality(String),
    date        Date,
    value       Float64
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (entity_type, entity_id, source, date)
;

CREATE TABLE IF NOT EXISTS keyword_signals
(
    keyword_id  UInt64,
    source      LowCardinality(String),
    country     LowCardinality(String),
    captured_at DateTime('UTC'),
    value       Float64
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (keyword_id, source, country, captured_at)
;

CREATE TABLE IF NOT EXISTS score_history
(
    entity_type     LowCardinality(String),
    entity_id       UInt64,
    date            Date,
    growth_velocity Float32,
    validation      Float32,
    saturation      Float32,
    opportunity     Float32,
    phase           LowCardinality(String),
    weights_version UInt32
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (entity_type, entity_id, date)
;

CREATE TABLE IF NOT EXISTS change_events
(
    event_type  LowCardinality(String),
    entity_type LowCardinality(String),
    entity_id   UInt64,
    occurred_at DateTime('UTC'),
    payload     String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (entity_type, entity_id, occurred_at)
TTL occurred_at + INTERVAL 2 YEAR
;
