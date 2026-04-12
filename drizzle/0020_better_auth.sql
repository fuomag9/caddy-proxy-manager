ALTER TABLE `users` ADD COLUMN `email_verified` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `username` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `display_username` text;
--> statement-breakpoint
DROP TABLE IF EXISTS `sessions`;
--> statement-breakpoint
CREATE TABLE `sessions` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `userId` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `token` text NOT NULL,
  `expiresAt` text NOT NULL,
  `ipAddress` text,
  `userAgent` text,
  `createdAt` text NOT NULL,
  `updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`userId`);
--> statement-breakpoint
CREATE TABLE `accounts` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `userId` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `accountId` text NOT NULL,
  `providerId` text NOT NULL,
  `accessToken` text,
  `refreshToken` text,
  `idToken` text,
  `accessTokenExpiresAt` text,
  `refreshTokenExpiresAt` text,
  `scope` text,
  `password` text,
  `createdAt` text NOT NULL,
  `updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_idx` ON `accounts` (`providerId`, `accountId`);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`userId`);
--> statement-breakpoint
CREATE TABLE `verifications` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expiresAt` text NOT NULL,
  `createdAt` text,
  `updatedAt` text
);
--> statement-breakpoint
CREATE TABLE `oauth_providers` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL DEFAULT 'oidc',
  `client_id` text NOT NULL,
  `client_secret` text NOT NULL,
  `issuer` text,
  `authorization_url` text,
  `token_url` text,
  `userinfo_url` text,
  `scopes` text NOT NULL DEFAULT 'openid email profile',
  `auto_link` integer NOT NULL DEFAULT 0,
  `enabled` integer NOT NULL DEFAULT 1,
  `source` text NOT NULL DEFAULT 'ui',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_providers_name_unique` ON `oauth_providers` (`name`);
