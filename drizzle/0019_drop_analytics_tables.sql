-- Analytics data (traffic_events, waf_events) has been migrated to ClickHouse.
DROP TABLE IF EXISTS traffic_events;
--> statement-breakpoint
DROP TABLE IF EXISTS waf_events;
