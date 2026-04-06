import { integer, text, sqliteTable, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash"),
    role: text("role").notNull().default("user"),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    avatarUrl: text("avatar_url"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    providerSubjectIdx: uniqueIndex("users_provider_subject_idx").on(table.provider, table.subject)
  })
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    token: text("token").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    tokenUnique: uniqueIndex("sessions_token_unique").on(table.token)
  })
);

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    state: text("state").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    redirectTo: text("redirect_to"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull()
  },
  (table) => ({
    stateUnique: uniqueIndex("oauth_state_unique").on(table.state)
  })
);

export const pendingOAuthLinks = sqliteTable("pending_oauth_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { length: 50 }).notNull(),
  userEmail: text("user_email").notNull(), // Email of the user who initiated linking
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull()
}, (table) => ({
  // Ensure only one pending link per user per provider (prevents race conditions)
  userProviderUnique: uniqueIndex("pending_oauth_user_provider_unique").on(table.userId, table.provider)
}));

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const instances = sqliteTable(
  "instances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    apiToken: text("api_token").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastSyncAt: text("last_sync_at"),
    lastSyncError: text("last_sync_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    baseUrlUnique: uniqueIndex("instances_base_url_unique").on(table.baseUrl)
  })
);

export const accessLists = sqliteTable("access_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const accessListEntries = sqliteTable(
  "access_list_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accessListId: integer("access_list_id")
      .references(() => accessLists.id, { onDelete: "cascade" })
      .notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    accessListIdIdx: index("access_list_entries_list_idx").on(table.accessListId)
  })
);

export const certificates = sqliteTable("certificates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  domainNames: text("domain_names").notNull(),
  autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(true),
  providerOptions: text("provider_options"),
  certificatePem: text("certificate_pem"),
  privateKeyPem: text("private_key_pem"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const caCertificates = sqliteTable("ca_certificates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  certificatePem: text("certificate_pem").notNull(),
  privateKeyPem: text("private_key_pem"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const issuedClientCertificates = sqliteTable(
  "issued_client_certificates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    caCertificateId: integer("ca_certificate_id")
      .references(() => caCertificates.id, { onDelete: "cascade" })
      .notNull(),
    commonName: text("common_name").notNull(),
    serialNumber: text("serial_number").notNull(),
    fingerprintSha256: text("fingerprint_sha256").notNull(),
    certificatePem: text("certificate_pem").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    revokedAt: text("revoked_at"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    caCertificateIdx: index("issued_client_certificates_ca_idx").on(table.caCertificateId),
    revokedAtIdx: index("issued_client_certificates_revoked_at_idx").on(table.revokedAt)
  })
);

export const proxyHosts = sqliteTable("proxy_hosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  domains: text("domains").notNull(),
  upstreams: text("upstreams").notNull(),
  certificateId: integer("certificate_id").references(() => certificates.id, { onDelete: "set null" }),
  accessListId: integer("access_list_id").references(() => accessLists.id, { onDelete: "set null" }),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  sslForced: integer("ssl_forced", { mode: "boolean" }).notNull().default(true),
  hstsEnabled: integer("hsts_enabled", { mode: "boolean" }).notNull().default(true),
  hstsSubdomains: integer("hsts_subdomains", { mode: "boolean" }).notNull().default(false),
  allowWebsocket: integer("allow_websocket", { mode: "boolean" }).notNull().default(true),
  preserveHostHeader: integer("preserve_host_header", { mode: "boolean" }).notNull().default(true),
  meta: text("meta"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  skipHttpsHostnameValidation: integer("skip_https_hostname_validation", { mode: "boolean" })
    .notNull()
    .default(false)
});

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdBy: integer("created_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    expiresAt: text("expires_at")
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("api_tokens_token_hash_unique").on(table.tokenHash)
  })
);

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  summary: text("summary"),
  data: text("data"),
  createdAt: text("created_at").notNull()
});

export const linkingTokens = sqliteTable("linking_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull()
});

export const trafficEvents = sqliteTable(
  'traffic_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    clientIp: text('client_ip').notNull(),
    countryCode: text('country_code'),
    host: text('host').notNull().default(''),
    method: text('method').notNull().default(''),
    uri: text('uri').notNull().default(''),
    status: integer('status').notNull().default(0),
    proto: text('proto').notNull().default(''),
    bytesSent: integer('bytes_sent').notNull().default(0),
    userAgent: text('user_agent').notNull().default(''),
    isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    tsIdx: index('idx_traffic_events_ts').on(table.ts),
    hostTsIdx: index('idx_traffic_events_host_ts').on(table.host, table.ts),
  })
);

export const logParseState = sqliteTable('log_parse_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const wafEvents = sqliteTable(
  'waf_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(),
    host: text('host').notNull().default(''),
    clientIp: text('client_ip').notNull(),
    countryCode: text('country_code'),
    method: text('method').notNull().default(''),
    uri: text('uri').notNull().default(''),
    ruleId: integer('rule_id'),
    ruleMessage: text('rule_message'),
    severity: text('severity'),
    rawData: text('raw_data'),
    blocked: integer('blocked', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => ({
    tsIdx: index('idx_waf_events_ts').on(table.ts),
    hostTsIdx: index('idx_waf_events_host_ts').on(table.host, table.ts),
  })
);

export const wafLogParseState = sqliteTable('waf_log_parse_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ── mTLS RBAC ──────────────────────────────────────────────────────────

export const mtlsRoles = sqliteTable(
  "mtls_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    nameUnique: uniqueIndex("mtls_roles_name_unique").on(table.name)
  })
);

export const mtlsCertificateRoles = sqliteTable(
  "mtls_certificate_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    issuedClientCertificateId: integer("issued_client_certificate_id")
      .references(() => issuedClientCertificates.id, { onDelete: "cascade" })
      .notNull(),
    mtlsRoleId: integer("mtls_role_id")
      .references(() => mtlsRoles.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    certRoleUnique: uniqueIndex("mtls_cert_role_unique").on(
      table.issuedClientCertificateId,
      table.mtlsRoleId
    ),
    roleIdx: index("mtls_certificate_roles_role_idx").on(table.mtlsRoleId)
  })
);

export const mtlsAccessRules = sqliteTable(
  "mtls_access_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proxyHostId: integer("proxy_host_id")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    pathPattern: text("path_pattern").notNull(),
    allowedRoleIds: text("allowed_role_ids").notNull().default("[]"),
    allowedCertIds: text("allowed_cert_ids").notNull().default("[]"),
    denyAll: integer("deny_all", { mode: "boolean" }).notNull().default(false),
    priority: integer("priority").notNull().default(0),
    description: text("description"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    proxyHostIdx: index("mtls_access_rules_proxy_host_idx").on(table.proxyHostId),
    hostPathUnique: uniqueIndex("mtls_access_rules_host_path_unique").on(
      table.proxyHostId,
      table.pathPattern
    )
  })
);

// ── Forward Auth (IdP) ───────────────────────────────────────────────

export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    nameUnique: uniqueIndex("groups_name_unique").on(table.name)
  })
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    memberUnique: uniqueIndex("group_members_unique").on(table.groupId, table.userId),
    userIdx: index("group_members_user_idx").on(table.userId)
  })
);

export const forwardAuthAccess = sqliteTable(
  "forward_auth_access",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proxyHostId: integer("proxy_host_id")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("group_id").references(() => groups.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    hostIdx: index("faa_host_idx").on(table.proxyHostId),
    userUnique: uniqueIndex("faa_user_unique").on(table.proxyHostId, table.userId),
    groupUnique: uniqueIndex("faa_group_unique").on(table.proxyHostId, table.groupId)
  })
);

export const forwardAuthSessions = sqliteTable(
  "forward_auth_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("fas_token_hash_unique").on(table.tokenHash),
    userIdx: index("fas_user_idx").on(table.userId),
    expiresIdx: index("fas_expires_idx").on(table.expiresAt)
  })
);

export const forwardAuthExchanges = sqliteTable(
  "forward_auth_exchanges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .references(() => forwardAuthSessions.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: text("code_hash").notNull(),
    sessionToken: text("session_token").notNull(), // raw session token (short-lived, single-use)
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: text("expires_at").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    codeHashUnique: uniqueIndex("fae_code_hash_unique").on(table.codeHash)
  })
);

export const forwardAuthRedirectIntents = sqliteTable(
  "forward_auth_redirect_intents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ridHash: text("rid_hash").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    ridHashUnique: uniqueIndex("fari_rid_hash_unique").on(table.ridHash),
    expiresIdx: index("fari_expires_idx").on(table.expiresAt)
  })
);

// ── L4 Proxy Hosts ───────────────────────────────────────────────────

export const l4ProxyHosts = sqliteTable("l4_proxy_hosts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  listenAddress: text("listen_address").notNull(),
  upstreams: text("upstreams").notNull(),
  matcherType: text("matcher_type").notNull().default("none"),
  matcherValue: text("matcher_value"),
  tlsTermination: integer("tls_termination", { mode: "boolean" }).notNull().default(false),
  proxyProtocolVersion: text("proxy_protocol_version"),
  proxyProtocolReceive: integer("proxy_protocol_receive", { mode: "boolean" }).notNull().default(false),
  ownerUserId: integer("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  meta: text("meta"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
