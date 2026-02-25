-- Remove static response feature columns from proxy_hosts
ALTER TABLE `proxy_hosts` DROP COLUMN `response_mode`;
--> statement-breakpoint
ALTER TABLE `proxy_hosts` DROP COLUMN `static_status_code`;
--> statement-breakpoint
ALTER TABLE `proxy_hosts` DROP COLUMN `static_response_body`;
