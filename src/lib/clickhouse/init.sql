-- Reference DDL for ClickHouse analytics tables.
-- Tables are created programmatically by client.ts initClickHouse().
-- This file is for documentation only.

CREATE TABLE IF NOT EXISTS traffic_events (
    ts          DateTime,
    client_ip   String,
    country_code Nullable(String),
    host        String DEFAULT '',
    method      String DEFAULT '',
    uri         String DEFAULT '',
    status      UInt16 DEFAULT 0,
    proto       String DEFAULT '',
    bytes_sent  UInt64 DEFAULT 0,
    user_agent  String DEFAULT '',
    is_blocked  Bool DEFAULT false
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS waf_events (
    ts           DateTime,
    host         String DEFAULT '',
    client_ip    String,
    country_code Nullable(String),
    method       String DEFAULT '',
    uri          String DEFAULT '',
    rule_id      Nullable(Int32),
    rule_message Nullable(String),
    severity     Nullable(String),
    raw_data     Nullable(String),
    blocked      Bool DEFAULT true
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;
