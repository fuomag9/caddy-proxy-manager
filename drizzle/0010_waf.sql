-- Custom SQL migration file, put your code below! --
CREATE TABLE `waf_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ts` integer NOT NULL,
  `host` text NOT NULL DEFAULT '',
  `client_ip` text NOT NULL,
  `country_code` text,
  `method` text NOT NULL DEFAULT '',
  `uri` text NOT NULL DEFAULT '',
  `rule_id` integer,
  `rule_message` text,
  `severity` text,
  `raw_data` text
);
--> statement-breakpoint
CREATE INDEX `idx_waf_events_ts` ON `waf_events` (`ts`);
--> statement-breakpoint
CREATE INDEX `idx_waf_events_host_ts` ON `waf_events` (`host`, `ts`);
--> statement-breakpoint
CREATE TABLE `waf_log_parse_state` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);
