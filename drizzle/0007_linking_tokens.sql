CREATE TABLE `linking_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `token` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `linking_tokens_expires_at_idx` ON `linking_tokens` (`expires_at`);
