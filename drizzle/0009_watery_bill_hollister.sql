-- Custom SQL migration file, put your code below! --
CREATE TABLE `traffic_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ts` integer NOT NULL,
  `client_ip` text NOT NULL,
  `country_code` text,
  `host` text NOT NULL DEFAULT '',
  `method` text NOT NULL DEFAULT '',
  `uri` text NOT NULL DEFAULT '',
  `status` integer NOT NULL DEFAULT 0,
  `proto` text NOT NULL DEFAULT '',
  `bytes_sent` integer NOT NULL DEFAULT 0,
  `user_agent` text NOT NULL DEFAULT '',
  `is_blocked` integer NOT NULL DEFAULT false
);
--> statement-breakpoint
CREATE INDEX `idx_traffic_events_ts` ON `traffic_events` (`ts`);
--> statement-breakpoint
CREATE INDEX `idx_traffic_events_host_ts` ON `traffic_events` (`host`, `ts`);
--> statement-breakpoint
CREATE TABLE `log_parse_state` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);
