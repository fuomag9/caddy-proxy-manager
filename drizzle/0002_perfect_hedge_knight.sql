-- Drop existing pending OAuth links (they're temporary with 5-minute expiry anyway)
DROP TABLE IF EXISTS `pending_oauth_links`;--> statement-breakpoint
-- Create new table with userEmail column and unique index
CREATE TABLE `pending_oauth_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text(50) NOT NULL,
	`user_email` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_oauth_user_provider_unique` ON `pending_oauth_links` (`user_id`,`provider`);