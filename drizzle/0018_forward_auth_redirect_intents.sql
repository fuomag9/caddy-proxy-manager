CREATE TABLE `forward_auth_redirect_intents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rid_hash` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fari_rid_hash_unique` ON `forward_auth_redirect_intents` (`rid_hash`);
--> statement-breakpoint
CREATE INDEX `fari_expires_idx` ON `forward_auth_redirect_intents` (`expires_at`);
