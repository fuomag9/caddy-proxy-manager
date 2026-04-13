-- users
ALTER TABLE "users" RENAME COLUMN "password_hash" TO "passwordHash";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "avatar_url" TO "avatarUrl";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "display_username" TO "displayUsername";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "email_verified" TO "emailVerified";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- oauth_providers
ALTER TABLE "oauth_providers" RENAME COLUMN "client_id" TO "clientId";--> statement-breakpoint
ALTER TABLE "oauth_providers" RENAME COLUMN "client_secret" TO "clientSecret";--> statement-breakpoint
ALTER TABLE "oauth_providers" RENAME COLUMN "authorization_url" TO "authorizationUrl";--> statement-breakpoint
ALTER TABLE "oauth_providers" RENAME COLUMN "token_url" TO "tokenUrl";--> statement-breakpoint
ALTER TABLE "oauth_providers" RENAME COLUMN "userinfo_url" TO "userinfoUrl";--> statement-breakpoint
ALTER TABLE "oauth_providers" RENAME COLUMN "auto_link" TO "autoLink";--> statement-breakpoint
ALTER TABLE "oauth_providers" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "oauth_providers" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- oauth_states
ALTER TABLE "oauth_states" RENAME COLUMN "code_verifier" TO "codeVerifier";--> statement-breakpoint
ALTER TABLE "oauth_states" RENAME COLUMN "redirect_to" TO "redirectTo";--> statement-breakpoint
ALTER TABLE "oauth_states" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "oauth_states" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint

-- pending_oauth_links
ALTER TABLE "pending_oauth_links" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "pending_oauth_links" RENAME COLUMN "user_email" TO "userEmail";--> statement-breakpoint
ALTER TABLE "pending_oauth_links" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "pending_oauth_links" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint

-- settings
ALTER TABLE "settings" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- instances
ALTER TABLE "instances" RENAME COLUMN "base_url" TO "baseUrl";--> statement-breakpoint
ALTER TABLE "instances" RENAME COLUMN "api_token" TO "apiToken";--> statement-breakpoint
ALTER TABLE "instances" RENAME COLUMN "last_sync_at" TO "lastSyncAt";--> statement-breakpoint
ALTER TABLE "instances" RENAME COLUMN "last_sync_error" TO "lastSyncError";--> statement-breakpoint
ALTER TABLE "instances" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "instances" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- access_lists
ALTER TABLE "access_lists" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "access_lists" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "access_lists" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- access_list_entries
ALTER TABLE "access_list_entries" RENAME COLUMN "access_list_id" TO "accessListId";--> statement-breakpoint
ALTER TABLE "access_list_entries" RENAME COLUMN "password_hash" TO "passwordHash";--> statement-breakpoint
ALTER TABLE "access_list_entries" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "access_list_entries" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- certificates
ALTER TABLE "certificates" RENAME COLUMN "domain_names" TO "domainNames";--> statement-breakpoint
ALTER TABLE "certificates" RENAME COLUMN "auto_renew" TO "autoRenew";--> statement-breakpoint
ALTER TABLE "certificates" RENAME COLUMN "provider_options" TO "providerOptions";--> statement-breakpoint
ALTER TABLE "certificates" RENAME COLUMN "certificate_pem" TO "certificatePem";--> statement-breakpoint
ALTER TABLE "certificates" RENAME COLUMN "private_key_pem" TO "privateKeyPem";--> statement-breakpoint
ALTER TABLE "certificates" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "certificates" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "certificates" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- ca_certificates
ALTER TABLE "ca_certificates" RENAME COLUMN "certificate_pem" TO "certificatePem";--> statement-breakpoint
ALTER TABLE "ca_certificates" RENAME COLUMN "private_key_pem" TO "privateKeyPem";--> statement-breakpoint
ALTER TABLE "ca_certificates" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "ca_certificates" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "ca_certificates" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- issued_client_certificates
ALTER TABLE "issued_client_certificates" RENAME COLUMN "ca_certificate_id" TO "caCertificateId";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "common_name" TO "commonName";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "serial_number" TO "serialNumber";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "fingerprint_sha256" TO "fingerprintSha256";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "certificate_pem" TO "certificatePem";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "valid_from" TO "validFrom";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "valid_to" TO "validTo";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "revoked_at" TO "revokedAt";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "issued_client_certificates" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- proxy_hosts
ALTER TABLE "proxy_hosts" RENAME COLUMN "certificate_id" TO "certificateId";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "access_list_id" TO "accessListId";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "owner_user_id" TO "ownerUserId";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "ssl_forced" TO "sslForced";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "hsts_enabled" TO "hstsEnabled";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "hsts_subdomains" TO "hstsSubdomains";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "allow_websocket" TO "allowWebsocket";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "preserve_host_header" TO "preserveHostHeader";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint
ALTER TABLE "proxy_hosts" RENAME COLUMN "skip_https_hostname_validation" TO "skipHttpsHostnameValidation";--> statement-breakpoint

-- api_tokens
ALTER TABLE "api_tokens" RENAME COLUMN "token_hash" TO "tokenHash";--> statement-breakpoint
ALTER TABLE "api_tokens" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "api_tokens" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "api_tokens" RENAME COLUMN "last_used_at" TO "lastUsedAt";--> statement-breakpoint
ALTER TABLE "api_tokens" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint

-- audit_events
ALTER TABLE "audit_events" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "audit_events" RENAME COLUMN "entity_type" TO "entityType";--> statement-breakpoint
ALTER TABLE "audit_events" RENAME COLUMN "entity_id" TO "entityId";--> statement-breakpoint
ALTER TABLE "audit_events" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint

-- linking_tokens (create with old column names if missing — some deployments never ran migration 0007)
CREATE TABLE IF NOT EXISTS "linking_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "token" text NOT NULL,
  "created_at" text NOT NULL,
  "expires_at" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "linking_tokens" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "linking_tokens" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint

-- mtls_roles
ALTER TABLE "mtls_roles" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "mtls_roles" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "mtls_roles" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- mtls_certificate_roles
ALTER TABLE "mtls_certificate_roles" RENAME COLUMN "issued_client_certificate_id" TO "issuedClientCertificateId";--> statement-breakpoint
ALTER TABLE "mtls_certificate_roles" RENAME COLUMN "mtls_role_id" TO "mtlsRoleId";--> statement-breakpoint
ALTER TABLE "mtls_certificate_roles" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint

-- mtls_access_rules
ALTER TABLE "mtls_access_rules" RENAME COLUMN "proxy_host_id" TO "proxyHostId";--> statement-breakpoint
ALTER TABLE "mtls_access_rules" RENAME COLUMN "path_pattern" TO "pathPattern";--> statement-breakpoint
ALTER TABLE "mtls_access_rules" RENAME COLUMN "allowed_role_ids" TO "allowedRoleIds";--> statement-breakpoint
ALTER TABLE "mtls_access_rules" RENAME COLUMN "allowed_cert_ids" TO "allowedCertIds";--> statement-breakpoint
ALTER TABLE "mtls_access_rules" RENAME COLUMN "deny_all" TO "denyAll";--> statement-breakpoint
ALTER TABLE "mtls_access_rules" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "mtls_access_rules" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "mtls_access_rules" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- groups
ALTER TABLE "groups" RENAME COLUMN "created_by" TO "createdBy";--> statement-breakpoint
ALTER TABLE "groups" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "groups" RENAME COLUMN "updated_at" TO "updatedAt";--> statement-breakpoint

-- group_members
ALTER TABLE "group_members" RENAME COLUMN "group_id" TO "groupId";--> statement-breakpoint
ALTER TABLE "group_members" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "group_members" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint

-- forward_auth_access
ALTER TABLE "forward_auth_access" RENAME COLUMN "proxy_host_id" TO "proxyHostId";--> statement-breakpoint
ALTER TABLE "forward_auth_access" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "forward_auth_access" RENAME COLUMN "group_id" TO "groupId";--> statement-breakpoint
ALTER TABLE "forward_auth_access" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint

-- forward_auth_sessions
ALTER TABLE "forward_auth_sessions" RENAME COLUMN "user_id" TO "userId";--> statement-breakpoint
ALTER TABLE "forward_auth_sessions" RENAME COLUMN "token_hash" TO "tokenHash";--> statement-breakpoint
ALTER TABLE "forward_auth_sessions" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint
ALTER TABLE "forward_auth_sessions" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint

-- forward_auth_exchanges
ALTER TABLE "forward_auth_exchanges" RENAME COLUMN "session_id" TO "sessionId";--> statement-breakpoint
ALTER TABLE "forward_auth_exchanges" RENAME COLUMN "code_hash" TO "codeHash";--> statement-breakpoint
ALTER TABLE "forward_auth_exchanges" RENAME COLUMN "session_token" TO "sessionToken";--> statement-breakpoint
ALTER TABLE "forward_auth_exchanges" RENAME COLUMN "redirect_uri" TO "redirectUri";--> statement-breakpoint
ALTER TABLE "forward_auth_exchanges" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint
ALTER TABLE "forward_auth_exchanges" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint

-- forward_auth_redirect_intents
ALTER TABLE "forward_auth_redirect_intents" RENAME COLUMN "rid_hash" TO "ridHash";--> statement-breakpoint
ALTER TABLE "forward_auth_redirect_intents" RENAME COLUMN "redirect_uri" TO "redirectUri";--> statement-breakpoint
ALTER TABLE "forward_auth_redirect_intents" RENAME COLUMN "expires_at" TO "expiresAt";--> statement-breakpoint
ALTER TABLE "forward_auth_redirect_intents" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint

-- l4_proxy_hosts
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "listen_address" TO "listenAddress";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "matcher_type" TO "matcherType";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "matcher_value" TO "matcherValue";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "tls_termination" TO "tlsTermination";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "proxy_protocol_version" TO "proxyProtocolVersion";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "proxy_protocol_receive" TO "proxyProtocolReceive";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "owner_user_id" TO "ownerUserId";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "created_at" TO "createdAt";--> statement-breakpoint
ALTER TABLE "l4_proxy_hosts" RENAME COLUMN "updated_at" TO "updatedAt";
