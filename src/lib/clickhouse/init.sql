-- Reference DDL for ClickHouse analytics tables.
-- Tables are created programmatically by client.ts initClickHouse().
-- This file is for documentation only.

CREATE TABLE IF NOT EXISTS traffic_events (
    ts           DateTime          CODEC(Delta, ZSTD),
    client_ip    String            CODEC(ZSTD(3)),
    country_code LowCardinality(Nullable(String)),
    host         LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    method       LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    uri          String            DEFAULT '' CODEC(ZSTD(3)),
    status       UInt16            DEFAULT 0,
    proto        LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    bytes_sent   UInt64            DEFAULT 0 CODEC(Delta, ZSTD),
    user_agent   String            DEFAULT '' CODEC(ZSTD(3)),
    is_blocked   Bool              DEFAULT false
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS waf_events (
    ts           DateTime          CODEC(Delta, ZSTD),
    host         LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    client_ip    String            CODEC(ZSTD(3)),
    country_code LowCardinality(Nullable(String)),
    method       LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    uri          String            DEFAULT '' CODEC(ZSTD(3)),
    rule_id      Nullable(Int32),
    rule_message Nullable(String)  CODEC(ZSTD(3)),
    severity     LowCardinality(Nullable(String)),
    raw_data     Nullable(String)  CODEC(ZSTD(3)),
    blocked      Bool              DEFAULT true
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;
