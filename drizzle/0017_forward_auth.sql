-- Forward Auth: groups, group membership, per-host access control, sessions, and exchange codes

CREATE TABLE `groups` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);
--> statement-breakpoint
CREATE TABLE `group_members` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `group_id` integer NOT NULL REFERENCES `groups`(`id`) ON DELETE CASCADE,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_unique` ON `group_members` (`group_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `group_members_user_idx` ON `group_members` (`user_id`);
--> statement-breakpoint
CREATE TABLE `forward_auth_access` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `proxy_host_id` integer NOT NULL REFERENCES `proxy_hosts`(`id`) ON DELETE CASCADE,
  `user_id` integer REFERENCES `users`(`id`) ON DELETE CASCADE,
  `group_id` integer REFERENCES `groups`(`id`) ON DELETE CASCADE,
  `created_at` text NOT NULL,
  CHECK ((`user_id` IS NOT NULL AND `group_id` IS NULL) OR (`user_id` IS NULL AND `group_id` IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `faa_host_idx` ON `forward_auth_access` (`proxy_host_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `faa_user_unique` ON `forward_auth_access` (`proxy_host_id`, `user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `faa_group_unique` ON `forward_auth_access` (`proxy_host_id`, `group_id`);
--> statement-breakpoint
CREATE TABLE `forward_auth_sessions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `token_hash` text NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fas_token_hash_unique` ON `forward_auth_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `fas_user_idx` ON `forward_auth_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `fas_expires_idx` ON `forward_auth_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `forward_auth_exchanges` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` integer NOT NULL REFERENCES `forward_auth_sessions`(`id`) ON DELETE CASCADE,
  `code_hash` text NOT NULL,
  `session_token` text NOT NULL,
  `redirect_uri` text NOT NULL,
  `expires_at` text NOT NULL,
  `used` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fae_code_hash_unique` ON `forward_auth_exchanges` (`code_hash`);
