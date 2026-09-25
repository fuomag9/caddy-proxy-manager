import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { genericOAuth, username } from "better-auth/plugins";
import db, { sqlite } from "./db";
import * as schema from "./db/schema";
import { and, eq } from "drizzle-orm";
import { config } from "./config";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret";
import type { OAuthProvider } from "./models/oauth-providers";
import type { GenericOAuthConfig } from "better-auth/plugins";
import {
  CREDENTIAL_ACCOUNT_ISSUER,
  resolveOAuthAccountIssuer,
} from "./account-issuer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedAuth: any = null;
let cachedProviders: GenericOAuthConfig[] | null = null;
let cachedTrustedProviderIds: string[] = [];

/**
 * OIDC spells the claim `email_verified`; some providers serialize it as a
 * string. Better Auth's generic-OAuth profile reader only looks at a camelCase
 * `emailVerified` field, so the claim has to be mapped explicitly.
 */
function profileEmailVerified(profile: Record<string, unknown>): boolean {
  const claim = profile.email_verified ?? profile.emailVerified;
  return claim === true || claim === "true";
}

export function mapOAuthProvider(p: OAuthProvider): GenericOAuthConfig {
  const cfg: GenericOAuthConfig = {
    providerId: p.id,
    clientId: p.clientId,
    clientSecret: p.clientSecret,
    scopes: p.scopes ? p.scopes.split(/[\s,]+/).filter(Boolean) : undefined,
    pkce: true,
    // Security: do not let an OAuth sign-in implicitly create a brand-new
    // account unless OAuth self-registration is explicitly enabled. Existing
    // users and (where configured) account linking still work — only first-time
    // auto-provisioning of an unknown identity is gated. Controlled by its own
    // flag, independent of credential self-registration.
    disableImplicitSignUp: !config.auth.allowOauthRegistration,
    // disableImplicitSignUp alone can be overridden by the client: Better Auth
    // honours a `requestSignUp: true` field on /sign-in/social. disableSignUp
    // closes account creation regardless of what the request asks for.
    disableSignUp: !config.auth.allowOauthRegistration,
    // Ownership of an existing CPM account is asserted by the operator through
    // the provider's auto-link switch, never by the IdP alone. Reporting the
    // claim only for auto-link providers keeps a provider that merely returns
    // `email_verified: true` from attaching itself to a local account.
    mapProfileToUser: (profile) => ({
      emailVerified: p.autoLink === true && profileEmailVerified(profile),
    }),
  };
  if (p.authorizationUrl) cfg.authorizationUrl = p.authorizationUrl;
  if (p.tokenUrl) cfg.tokenUrl = p.tokenUrl;
  if (p.userinfoUrl) cfg.userInfoUrl = p.userinfoUrl;
  if (p.issuer) {
    // Only use discovery when explicit URLs are not provided
    if (!p.authorizationUrl && !p.tokenUrl) {
      cfg.discoveryUrl = p.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
    }
  }
  return cfg;
}

/** Whether provider load succeeded at least once */
let providersLoadedSuccessfully = false;

function loadProvidersSync(): GenericOAuthConfig[] {
  // If we have a successful cache, use it
  if (cachedProviders !== null && providersLoadedSuccessfully) return cachedProviders;

  // If cache is empty from a failed attempt, retry on every call until it succeeds
  try {
    const rows = db.select().from(schema.oauthProviders)
      .where(eq(schema.oauthProviders.enabled, true)).all();
    const providers: OAuthProvider[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      clientId: decryptSecret(row.clientId, `OAuth provider "${row.name}"`),
      clientSecret: decryptSecret(row.clientSecret, `OAuth provider "${row.name}"`),
      issuer: row.issuer,
      authorizationUrl: row.authorizationUrl,
      tokenUrl: row.tokenUrl,
      userinfoUrl: row.userinfoUrl,
      scopes: row.scopes,
      autoLink: row.autoLink,
      enabled: row.enabled,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    cachedProviders = providers.map(mapOAuthProvider);
    cachedTrustedProviderIds = providers.filter((p) => p.autoLink).map((p) => p.id);
    providersLoadedSuccessfully = true;
  } catch (e) {
    // DB not ready yet — start with empty, will retry on next getAuth() call
    if (!cachedProviders) cachedProviders = [];
    console.warn("[auth-server] Failed to load OAuth providers (will retry):", e);
  }

  return cachedProviders;
}

/**
 * Security: force privileged user fields to safe defaults on every
 * better-auth-managed user creation (OAuth signup, and credential signup when
 * enabled). better-auth's generic-OAuth signup spreads the raw IdP profile
 * claims into the new user record (createOAuthUser({...restUserInfo})) and does
 * NOT honour the `input:false` flags declared on these additionalFields, so
 * without this a permissive or attacker-influenced IdP returning a `role` (or
 * `status`) claim could self-provision an admin account.
 *
 * Admin-initiated user creation goes through models/user.ts (a direct insert
 * that bypasses better-auth's database hooks), so legitimate role assignment is
 * unaffected. `provider`/`subject` are informational, not access-control, and
 * are intentionally left untouched.
 */
export function enforceSafeUserDefaults<T extends object>(user: T): T & { role: string; status: string } {
  return { ...user, role: "user", status: "active" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createAuth(): any {
  const oauthConfigs = loadProvidersSync();
  const trustedProviderIds = [...cachedTrustedProviderIds];

  return betterAuth({
    database: sqlite,
    secret: config.sessionSecret,
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    // Only trust the Host header when the operator explicitly opts in.
    // baseURL already pins the canonical origin; trustHost is only needed
    // behind reverse proxies that rewrite Host without setting X-Forwarded-Host.
    trustHost: process.env.AUTH_TRUST_HOST === "true",
    trustedOrigins: [config.baseUrl],
    // Self-service endpoints CPM does not use. Profile, password and account
    // changes go through CPM's own routes, which enforce its password policy,
    // keep users.passwordHash in sync and audit the change; leaving Better
    // Auth's equivalents reachable would bypass all of that (and let users
    // rename themselves, which feeds the forward-auth X-CPM-User header).
    disabledPaths: [
      "/update-user",
      "/change-password",
      "/change-email",
      "/delete-user",
      "/unlink-account",
      "/update-session",
      "/verify-password",
      "/is-username-available",
    ],
    advanced: {
      database: {
        generateId: "serial",
      },
    } as Record<string, unknown>,
    rateLimit: {
      enabled: process.env.AUTH_RATE_LIMIT_ENABLED !== "false",
      window: Number(process.env.AUTH_RATE_LIMIT_WINDOW ?? 60),
      max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 5),
    },
    user: {
      modelName: "users",
      fields: {
        image: "avatarUrl",
      },
      additionalFields: {
        role: { type: "string", defaultValue: "user", input: false },
        status: { type: "string", defaultValue: "active", input: false },
        provider: { type: "string", defaultValue: "", input: false },
        subject: { type: "string", defaultValue: "", input: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: 7 * 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "accounts",
      accountLinking: {
        enabled: true,
        // A provider with "Auto-link accounts" enabled is trusted to prove that
        // its identity owns the CPM account carrying the same email address.
        trustedProviders: trustedProviderIds,
        // CPM has no local email-verification flow, so a user row's
        // emailVerified is never set and the default gate would refuse every
        // link. The per-provider trust decision above is the ownership signal.
        requireLocalEmailVerified: false,
      },
    },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.auth.allowSelfRegistration,
      password: {
        async hash(password: string) {
          const bcrypt = await import("bcryptjs");
          return await bcrypt.default.hash(password, 12);
        },
        async verify({ hash, password }: { hash: string; password: string }) {
          const bcrypt = await import("bcryptjs");
          return await bcrypt.default.compare(password, hash);
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // By default, never let an external IdP set privileged fields
          // (role/status) on a newly federated user — see enforceSafeUserDefaults
          // above. Operators who trust their IdP to manage roles can opt out
          // with AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS=true.
          before: async (user: Record<string, unknown>) => {
            if (config.auth.allowOauthRoleFromClaims) {
              return { data: user };
            }
            return { data: enforceSafeUserDefaults(user) };
          },
        },
      },
      account: {
        create: {
          before: async (account) => {
            const data = { ...account };
            if (data.accessToken) data.accessToken = encryptSecret(data.accessToken);
            if (data.refreshToken) data.refreshToken = encryptSecret(data.refreshToken);
            if (data.idToken) data.idToken = encryptSecret(data.idToken);
            // Better Auth 1.7.4 removed `issuer` from the account schema and
            // keys external identities by (providerId, accountId). CPM's
            // `accounts` table keeps a NOT NULL `issuer` column (with a
            // database default — see migration 0025 / issue #283) for its own
            // identity bookkeeping. Derive the namespace here: the credential
            // namespace for local password accounts, or the provider's
            // pinned/synthetic OAuth issuer otherwise.
            //
            // NOTE: this assignment does NOT survive to the database on
            // Better Auth 1.7.4 — its adapter maps inserts through the account
            // model's own fields and silently drops unknown ones like `issuer`
            // (verified against node_modules internals). The column default is
            // what actually satisfies the insert, and the account.create.after
            // hook below backfills the real namespace afterwards.
            const providerId = typeof data.providerId === "string" ? data.providerId : null;
            if (providerId) {
              const configured = providerId === "credential"
                ? null
                : await db
                    .select({ issuer: schema.oauthProviders.issuer })
                    .from(schema.oauthProviders)
                    .where(eq(schema.oauthProviders.id, providerId))
                    .get();
              // `issuer` is a CPM-only column absent from Better Auth 1.7.4's
              // account model, so assign through the widened record type.
              (data as Record<string, unknown>).issuer = configured === null
                ? CREDENTIAL_ACCOUNT_ISSUER
                : resolveOAuthAccountIssuer(providerId, configured?.issuer);
            }
            return { data };
          },
          after: async (account) => {
            // Better Auth 1.7.4's insert pipeline drops the issuer the `before`
            // hook assigns (unknown field), so accounts created by Better Auth
            // itself (credential link-account on sign-up, federated identities)
            // land with the column default ''. CPM queries key on issuer
            // namespaces (password change, account linking, identity lookup),
            // so backfill the real namespace here. The drizzle db shares the
            // same SQLite client Better Auth writes through, so this joins any
            // open transaction instead of deadlocking on a second connection.
            try {
              const providerId = typeof account.providerId === "string" && account.providerId
                ? account.providerId
                : null;
              const accountId = typeof account.accountId === "string" && account.accountId
                ? account.accountId
                : null;
              const userId = typeof account.userId === "string" ? Number(account.userId) : account.userId;
              if (providerId && accountId && Number.isFinite(userId)) {
                const configured = providerId === "credential"
                  ? null
                  : await db
                      .select({ issuer: schema.oauthProviders.issuer })
                      .from(schema.oauthProviders)
                      .where(eq(schema.oauthProviders.id, providerId))
                      .get();
                const issuer = providerId === "credential"
                  ? CREDENTIAL_ACCOUNT_ISSUER
                  : resolveOAuthAccountIssuer(providerId, configured?.issuer);
                if (issuer) {
                  db.update(schema.accounts)
                    .set({ issuer })
                    .where(and(
                      eq(schema.accounts.userId, userId),
                      eq(schema.accounts.providerId, providerId),
                      eq(schema.accounts.accountId, accountId),
                      eq(schema.accounts.issuer, "")
                    ))
                    .run();
                }
              }
            } catch (e) {
              // Bookkeeping only — never break authentication over it.
              console.warn("[auth-server] Failed to backfill accounts.issuer:", e);
            }
            // Better Auth writes federated identities to the `accounts` table
            // only. Re-derive the informational users.provider/subject columns
            // from it so auto-linking, profile linking, and federated sign-up
            // are all reflected in the CPM user state (#261).
            try {
              const { syncUserOAuthIdentity } = await import("./models/user");
              const userId = typeof account.userId === "string" ? Number(account.userId) : account.userId;
              if (Number.isFinite(userId)) {
                await syncUserOAuthIdentity(userId);
              }
            } catch (e) {
              // Informational columns only — never break authentication over them.
              console.warn("[auth-server] Failed to sync users.provider/subject from accounts:", e);
            }
          },
        },
        update: {
          before: async (account) => {
            const data = { ...account };
            if (data.accessToken && !isEncryptedSecret(data.accessToken)) data.accessToken = encryptSecret(data.accessToken);
            if (data.refreshToken && !isEncryptedSecret(data.refreshToken)) data.refreshToken = encryptSecret(data.refreshToken);
            if (data.idToken && !isEncryptedSecret(data.idToken)) data.idToken = encryptSecret(data.idToken);
            return { data };
          },
          after: async (account) => {
            // Repeat OAuth sign-ins update the existing account row rather than
            // creating one; keep the projection fresh in that path too.
            try {
              const { syncUserOAuthIdentity } = await import("./models/user");
              const userId = typeof account.userId === "string" ? Number(account.userId) : account.userId;
              if (Number.isFinite(userId)) {
                await syncUserOAuthIdentity(userId);
              }
            } catch (e) {
              console.warn("[auth-server] Failed to sync users.provider/subject from accounts:", e);
            }
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            try {
              const { createAuditEvent } = await import("./models/audit");
              await createAuditEvent({
                userId: typeof session.userId === "string" ? Number(session.userId) : session.userId,
                action: "login_success",
                entityType: "session",
                entityId: null,
                summary: "User signed in",
              });
            } catch {
              // Don't break auth flow if audit logging fails
            }
          },
        },
      },
    },
    plugins: [
      // Cast via unknown: better-auth's `username` plugin declares
      // databaseHooks.user.create.before's `email: string` (required) while BetterAuthPlugin
      // expects `email?: any`. The mismatch surfaces in some environments and not others, so
      // the cast keeps the typecheck stable across local and Docker builds.
      username({
        maxUsernameLength: 255,
        usernameValidator: (username) => /^[a-zA-Z0-9_.@-]+$/.test(username),
      }) as unknown as BetterAuthPlugin,
      genericOAuth({ config: oauthConfigs }),
    ],
  });
}

export function getAuth(): ReturnType<typeof betterAuth> {
  // Rebuild if providers failed to load initially and are now available
  if (cachedAuth && !providersLoadedSuccessfully) {
    cachedProviders = null;
    cachedAuth = null;
  }
  if (!cachedAuth) {
    cachedAuth = createAuth();
  }
  return cachedAuth;
}

export function invalidateProviderCache(): void {
  cachedProviders = null;
  cachedTrustedProviderIds = [];
  providersLoadedSuccessfully = false;
  cachedAuth = null;
}
