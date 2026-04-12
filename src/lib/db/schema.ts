import { integer, text, sqliteTable, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("passwordHash"),
    role: text("role").notNull().default("user"),
    provider: text("provider"),
    subject: text("subject"),
    avatarUrl: text("avatarUrl"),
    status: text("status").notNull().default("active"),
    username: text("username"),
    displayUsername: text("displayUsername"),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email)
  })
);

// Auth tables use camelCase DB columns to match Better Auth's Kysely adapter.
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    token: text("token").notNull(),
    expiresAt: text("expiresAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    tokenUnique: uniqueIndex("sessions_token_unique").on(table.token),
    userIdx: index("sessions_user_idx").on(table.userId)
  })
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: text("accessTokenExpiresAt"),
    refreshTokenExpiresAt: text("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    providerAccountIdx: uniqueIndex("accounts_provider_account_idx").on(table.providerId, table.accountId),
    userIdx: index("accounts_user_idx").on(table.userId)
  })
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt"),
    updatedAt: text("updatedAt")
  }
);

export const oauthProviders = sqliteTable(
  "oauth_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull().default("oidc"),
    clientId: text("clientId").notNull(),
    clientSecret: text("clientSecret").notNull(),
    issuer: text("issuer"),
    authorizationUrl: text("authorizationUrl"),
    tokenUrl: text("tokenUrl"),
    userinfoUrl: text("userinfoUrl"),
    scopes: text("scopes").notNull().default("openid email profile"),
    autoLink: integer("autoLink", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    source: text("source").notNull().default("ui"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    nameUnique: uniqueIndex("oauth_providers_name_unique").on(table.name)
  })
);

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    state: text("state").notNull(),
    codeVerifier: text("codeVerifier").notNull(),
    redirectTo: text("redirectTo"),
    createdAt: text("createdAt").notNull(),
    expiresAt: text("expiresAt").notNull()
  },
  (table) => ({
    stateUnique: uniqueIndex("oauth_state_unique").on(table.state)
  })
);

export const pendingOAuthLinks = sqliteTable("pending_oauth_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { length: 50 }).notNull(),
  userEmail: text("userEmail").notNull(), // Email of the user who initiated linking
  createdAt: text("createdAt").notNull(),
  expiresAt: text("expiresAt").notNull()
}, (table) => ({
  // Ensure only one pending link per user per provider (prevents race conditions)
  userProviderUnique: uniqueIndex("pending_oauth_user_provider_unique").on(table.userId, table.provider)
}));

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updatedAt").notNull()
});

export const instances = sqliteTable(
  "instances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    baseUrl: text("baseUrl").notNull(),
    apiToken: text("apiToken").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastSyncAt: text("lastSyncAt"),
    lastSyncError: text("lastSyncError"),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    baseUrlUnique: uniqueIndex("instances_base_url_unique").on(table.baseUrl)
  })
);

export const accessLists = sqliteTable("access_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull()
});

export const accessListEntries = sqliteTable(
  "access_list_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accessListId: integer("accessListId")
      .references(() => accessLists.id, { onDelete: "cascade" })
      .notNull(),
    username: text("username").notNull(),
    passwordHash: text("passwordHash").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    accessListIdIdx: index("access_list_entries_list_idx").on(table.accessListId)
  })
);

export const certificates = sqliteTable("certificates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  domainNames: text("domainNames").notNull(),
  autoRenew: integer("autoRenew", { mode: "boolean" }).notNull().default(true),
  providerOptions: text("providerOptions"),
  certificatePem: text("certificatePem"),
  privateKeyPem: text("privateKeyPem"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull()
});

export const caCertificates = sqliteTable("ca_certificates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  certificatePem: text("certificatePem").notNull(),
  privateKeyPem: text("privateKeyPem"),
  createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull()
});

export const issuedClientCertificates = sqliteTable(
  "issued_client_certificates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    caCertificateId: integer("caCertificateId")
      .references(() => caCertificates.id, { onDelete: "cascade" })
      .notNull(),
    commonName: text("commonName").notNull(),
    serialNumber: text("serialNumber").notNull(),
    fingerprintSha256: text("fingerprintSha256").notNull(),
    certificatePem: text("certificatePem").notNull(),
    validFrom: text("validFrom").notNull(),
    validTo: text("validTo").notNull(),
    revokedAt: text("revokedAt"),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
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
  certificateId: integer("certificateId").references(() => certificates.id, { onDelete: "set null" }),
  accessListId: integer("accessListId").references(() => accessLists.id, { onDelete: "set null" }),
  ownerUserId: integer("ownerUserId").references(() => users.id, { onDelete: "set null" }),
  sslForced: integer("sslForced", { mode: "boolean" }).notNull().default(true),
  hstsEnabled: integer("hstsEnabled", { mode: "boolean" }).notNull().default(true),
  hstsSubdomains: integer("hstsSubdomains", { mode: "boolean" }).notNull().default(false),
  allowWebsocket: integer("allowWebsocket", { mode: "boolean" }).notNull().default(true),
  preserveHostHeader: integer("preserveHostHeader", { mode: "boolean" }).notNull().default(true),
  meta: text("meta"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
  skipHttpsHostnameValidation: integer("skipHttpsHostnameValidation", { mode: "boolean" })
    .notNull()
    .default(false)
});

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    tokenHash: text("tokenHash").notNull(),
    createdBy: integer("createdBy")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("createdAt").notNull(),
    lastUsedAt: text("lastUsedAt"),
    expiresAt: text("expiresAt")
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("api_tokens_token_hash_unique").on(table.tokenHash)
  })
);

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entityType").notNull(),
  entityId: integer("entityId"),
  summary: text("summary"),
  data: text("data"),
  createdAt: text("createdAt").notNull()
});

export const linkingTokens = sqliteTable("linking_tokens", {
  id: text("id").primaryKey(),
  token: text("token").notNull(),
  createdAt: text("createdAt").notNull(),
  expiresAt: text("expiresAt").notNull()
});

// traffic_events and waf_events have been migrated to ClickHouse.
// See src/lib/clickhouse/client.ts for the ClickHouse schema.

export const logParseState = sqliteTable('log_parse_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

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
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    nameUnique: uniqueIndex("mtls_roles_name_unique").on(table.name)
  })
);

export const mtlsCertificateRoles = sqliteTable(
  "mtls_certificate_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    issuedClientCertificateId: integer("issuedClientCertificateId")
      .references(() => issuedClientCertificates.id, { onDelete: "cascade" })
      .notNull(),
    mtlsRoleId: integer("mtlsRoleId")
      .references(() => mtlsRoles.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("createdAt").notNull()
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
    proxyHostId: integer("proxyHostId")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    pathPattern: text("pathPattern").notNull(),
    allowedRoleIds: text("allowedRoleIds").notNull().default("[]"),
    allowedCertIds: text("allowedCertIds").notNull().default("[]"),
    denyAll: integer("denyAll", { mode: "boolean" }).notNull().default(false),
    priority: integer("priority").notNull().default(0),
    description: text("description"),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
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
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull()
  },
  (table) => ({
    nameUnique: uniqueIndex("groups_name_unique").on(table.name)
  })
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("groupId")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: text("createdAt").notNull()
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
    proxyHostId: integer("proxyHostId")
      .references(() => proxyHosts.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("userId").references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("groupId").references(() => groups.id, { onDelete: "cascade" }),
    createdAt: text("createdAt").notNull()
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
    userId: integer("userId")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("tokenHash").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull()
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
    sessionId: integer("sessionId")
      .references(() => forwardAuthSessions.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: text("codeHash").notNull(),
    sessionToken: text("sessionToken").notNull(), // raw session token (short-lived, single-use)
    redirectUri: text("redirectUri").notNull(),
    expiresAt: text("expiresAt").notNull(),
    used: integer("used", { mode: "boolean" }).notNull().default(false),
    createdAt: text("createdAt").notNull()
  },
  (table) => ({
    codeHashUnique: uniqueIndex("fae_code_hash_unique").on(table.codeHash)
  })
);

export const forwardAuthRedirectIntents = sqliteTable(
  "forward_auth_redirect_intents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ridHash: text("ridHash").notNull(),
    redirectUri: text("redirectUri").notNull(),
    expiresAt: text("expiresAt").notNull(),
    consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
    createdAt: text("createdAt").notNull()
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
  listenAddress: text("listenAddress").notNull(),
  upstreams: text("upstreams").notNull(),
  matcherType: text("matcherType").notNull().default("none"),
  matcherValue: text("matcherValue"),
  tlsTermination: integer("tlsTermination", { mode: "boolean" }).notNull().default(false),
  proxyProtocolVersion: text("proxyProtocolVersion"),
  proxyProtocolReceive: integer("proxyProtocolReceive", { mode: "boolean" }).notNull().default(false),
  ownerUserId: integer("ownerUserId").references(() => users.id, { onDelete: "set null" }),
  meta: text("meta"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});
