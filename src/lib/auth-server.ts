import { betterAuth } from "better-auth";
import { genericOAuth, username } from "better-auth/plugins";
import { randomUUID } from "node:crypto";
import db, { sqlite } from "./db";
import * as schema from "./db/schema";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { decryptSecret } from "./secret";
import type { OAuthProvider } from "./models/oauth-providers";
import type { GenericOAuthConfig } from "better-auth/plugins";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedAuth: any = null;
let cachedProviders: GenericOAuthConfig[] | null = null;

function mapOAuthProvider(p: OAuthProvider): GenericOAuthConfig {
  const cfg: GenericOAuthConfig = {
    providerId: p.id,
    clientId: p.clientId,
    clientSecret: p.clientSecret,
    scopes: p.scopes ? p.scopes.split(/[\s,]+/).filter(Boolean) : undefined,
    pkce: true,
  };
  if (p.authorizationUrl) cfg.authorizationUrl = p.authorizationUrl;
  if (p.tokenUrl) cfg.tokenUrl = p.tokenUrl;
  if (p.userinfoUrl) cfg.userInfoUrl = p.userinfoUrl;
  if (p.issuer) {
    cfg.issuer = p.issuer;
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
      clientId: decryptSecret(row.clientId),
      clientSecret: decryptSecret(row.clientSecret),
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
    providersLoadedSuccessfully = true;
  } catch (e) {
    // DB not ready yet — start with empty, will retry on next getAuth() call
    if (!cachedProviders) cachedProviders = [];
    console.warn("[auth-server] Failed to load OAuth providers (will retry):", e);
  }

  return cachedProviders;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createAuth(): any {
  const oauthConfigs = loadProvidersSync();

  return betterAuth({
    database: sqlite,
    secret: config.sessionSecret,
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    trustedOrigins: [config.baseUrl],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    advanced: {
      database: {
        generateId: "serial",
      },
    } as any,
    rateLimit: {
      enabled: process.env.AUTH_RATE_LIMIT_ENABLED !== "false",
      window: Number(process.env.AUTH_RATE_LIMIT_WINDOW ?? 10),
      max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 200),
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
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      password: {
        async hash(password: string) {
          const bcrypt = await import("bcryptjs");
          return bcrypt.default.hashSync(password, 12);
        },
        async verify({ hash, password }: { hash: string; password: string }) {
          const bcrypt = await import("bcryptjs");
          return bcrypt.default.compareSync(password, hash);
        },
      },
    },
    plugins: [
      username(),
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
  providersLoadedSuccessfully = false;
  cachedAuth = null;
}
