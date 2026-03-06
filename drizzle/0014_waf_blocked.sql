-- Add blocked column to waf_events.
-- Existing rows are backfilled as blocked=1 (they were all captured via is_interrupted=true).
ALTER TABLE `waf_events` ADD COLUMN `blocked` integer NOT NULL DEFAULT 1;
