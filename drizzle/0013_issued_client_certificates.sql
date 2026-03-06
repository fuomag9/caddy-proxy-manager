CREATE TABLE `issued_client_certificates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ca_certificate_id` integer NOT NULL REFERENCES `ca_certificates`(`id`) ON DELETE cascade,
  `common_name` text NOT NULL,
  `serial_number` text NOT NULL,
  `fingerprint_sha256` text NOT NULL,
  `certificate_pem` text NOT NULL,
  `valid_from` text NOT NULL,
  `valid_to` text NOT NULL,
  `revoked_at` text,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE set null,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `issued_client_certificates_ca_idx` ON `issued_client_certificates` (`ca_certificate_id`);
CREATE INDEX `issued_client_certificates_revoked_at_idx` ON `issued_client_certificates` (`revoked_at`);
