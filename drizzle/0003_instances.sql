CREATE TABLE `instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_token` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sync_at` text,
	`last_sync_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instances_base_url_unique` ON `instances` (`base_url`);