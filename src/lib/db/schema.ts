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
    providerSubjectIdx: index("users_provider_subject_idx").on(table.provider, table.subject)
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
