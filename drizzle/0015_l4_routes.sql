-- Custom SQL migration file, put your code below! --
CREATE TABLE `l4_routes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `listen_addresses` text NOT NULL,
  `matchers` text,
  `handler_type` text NOT NULL DEFAULT 'proxy',
  `upstreams` text,
  `tls_termination` integer NOT NULL DEFAULT 0,
  `proxy_protocol` text,
  `matching_timeout` text,
  `enabled` integer NOT NULL DEFAULT 1,
  `meta` text,
  `owner_user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_l4_routes_enabled` ON `l4_routes` (`enabled`);
