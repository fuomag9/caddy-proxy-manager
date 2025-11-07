CREATE TABLE `access_list_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`access_list_id` integer NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`access_list_id`) REFERENCES `access_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_list_entries_list_idx` ON `access_list_entries` (`access_list_id`);--> statement-breakpoint
CREATE TABLE `access_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`summary` text,
	`data` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`domain_names` text NOT NULL,
	`auto_renew` integer DEFAULT true NOT NULL,
	`provider_options` text,
	`certificate_pem` text,
	`private_key_pem` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `dead_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domains` text NOT NULL,
	`status_code` integer DEFAULT 503 NOT NULL,
	`response_body` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_to` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_state_unique` ON `oauth_states` (`state`);--> statement-breakpoint
CREATE TABLE `proxy_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domains` text NOT NULL,
	`upstreams` text NOT NULL,
	`certificate_id` integer,
	`access_list_id` integer,
	`owner_user_id` integer,
	`ssl_forced` integer DEFAULT true NOT NULL,
	`hsts_enabled` integer DEFAULT true NOT NULL,
	`hsts_subdomains` integer DEFAULT false NOT NULL,
	`allow_websocket` integer DEFAULT true NOT NULL,
	`preserve_host_header` integer DEFAULT true NOT NULL,
	`meta` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`skip_https_hostname_validation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`certificate_id`) REFERENCES `certificates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`access_list_id`) REFERENCES `access_lists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `redirect_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domains` text NOT NULL,
	`destination` text NOT NULL,
	`status_code` integer DEFAULT 302 NOT NULL,
	`preserve_query` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`password_hash` text,
	`role` text DEFAULT 'user' NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`avatar_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_provider_subject_idx` ON `users` (`provider`,`subject`);