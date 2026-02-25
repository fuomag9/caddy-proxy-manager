DROP INDEX IF EXISTS `users_provider_subject_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_provider_subject_idx` ON `users`(`provider`,`subject`);
