-- mTLS RBAC: roles, certificate-role assignments, and path-based access rules

CREATE TABLE `mtls_roles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mtls_roles_name_unique` ON `mtls_roles` (`name`);
--> statement-breakpoint
CREATE TABLE `mtls_certificate_roles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `issued_client_certificate_id` integer NOT NULL REFERENCES `issued_client_certificates`(`id`) ON DELETE CASCADE,
  `mtls_role_id` integer NOT NULL REFERENCES `mtls_roles`(`id`) ON DELETE CASCADE,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mtls_cert_role_unique` ON `mtls_certificate_roles` (`issued_client_certificate_id`, `mtls_role_id`);
--> statement-breakpoint
CREATE INDEX `mtls_certificate_roles_role_idx` ON `mtls_certificate_roles` (`mtls_role_id`);
--> statement-breakpoint
CREATE TABLE `mtls_access_rules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `proxy_host_id` integer NOT NULL REFERENCES `proxy_hosts`(`id`) ON DELETE CASCADE,
  `path_pattern` text NOT NULL,
  `allowed_role_ids` text NOT NULL DEFAULT '[]',
  `allowed_cert_ids` text NOT NULL DEFAULT '[]',
  `deny_all` integer NOT NULL DEFAULT 0,
  `priority` integer NOT NULL DEFAULT 0,
  `description` text,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mtls_access_rules_proxy_host_idx` ON `mtls_access_rules` (`proxy_host_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `mtls_access_rules_host_path_unique` ON `mtls_access_rules` (`proxy_host_id`, `path_pattern`);
