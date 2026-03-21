CREATE TABLE `l4_proxy_hosts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `protocol` text NOT NULL,
  `listen_address` text NOT NULL,
  `upstreams` text NOT NULL,
  `matcher_type` text NOT NULL DEFAULT 'none',
  `matcher_value` text,
  `tls_termination` integer NOT NULL DEFAULT false,
  `proxy_protocol_version` text,
  `proxy_protocol_receive` integer NOT NULL DEFAULT false,
  `owner_user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `meta` text,
  `enabled` integer NOT NULL DEFAULT true,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
