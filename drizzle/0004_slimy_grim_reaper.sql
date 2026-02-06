DROP TABLE `dead_hosts`;--> statement-breakpoint
ALTER TABLE `proxy_hosts` ADD `response_mode` text DEFAULT 'proxy' NOT NULL;--> statement-breakpoint
ALTER TABLE `proxy_hosts` ADD `static_status_code` integer DEFAULT 200;--> statement-breakpoint
ALTER TABLE `proxy_hosts` ADD `static_response_body` text;