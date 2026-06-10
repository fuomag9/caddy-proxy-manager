const DEV_SECRET = "dev-secret-change-in-production-12345678901234567890123456789012";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";
const DISALLOWED_SESSION_SECRETS = new Set([
  "change-me-in-production",
  "dev-secret-change-in-production-12345678901234567890123456789012"
]);
const DEFAULT_CADDY_URL = process.env.NODE_ENV === "development" ? "http://localhost:2019" : "http://caddy:2019";
const MIN_SESSION_SECRET_LENGTH = 32;
const MIN_ADMIN_PASSWORD_LENGTH = 12;

const isProduction = process.env.NODE_ENV === "production";
const isNodeRuntime = process.env.NEXT_RUNTIME === "nodejs";
const isDevelopment = process.env.NODE_ENV === "development";
// Only enforce strict validation in actual production runtime, not during build
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build" || !process.env.NEXT_RUNTIME;
const isRuntimeProduction = isProduction && isNodeRuntime && !isBuildPhase;

function resolveSessionSecret(): string {
  const rawSecret = process.env.SESSION_SECRET ?? null;
  const secret = rawSecret?.trim();

  // In development, allow missing secret
  if (isDevelopment && !secret) {
    return DEV_SECRET;
  }

  // In production build phase, allow temporary value
  if (isProduction && !isNodeRuntime && !secret) {
    return DEV_SECRET;
  }

  // Fail-closed on unrecognized NODE_ENV to prevent silent DEV_SECRET usage
  if (!isDevelopment && !isProduction && !secret) {
    throw new Error(
      `SESSION_SECRET is required when NODE_ENV="${process.env.NODE_ENV ?? ""}" ` +
      `(not "development" or "production"). ` +
      "Generate a secure secret with: openssl rand -base64 32"
    );
  }

  // Use provided secret or dev secret (only reachable in development)
  const finalSecret = secret || DEV_SECRET;

  // Strict validation in production runtime
  if (isRuntimeProduction) {
    if (!secret) {
      throw new Error(
        "SESSION_SECRET environment variable is required in production. " +
        "Generate a secure secret with: openssl rand -base64 32"
      );
    }
    if (DISALLOWED_SESSION_SECRETS.has(secret)) {
      throw new Error(
        "SESSION_SECRET is using a known insecure placeholder value. " +
        "Generate a secure secret with: openssl rand -base64 32"
      );
    }
    if (secret.length < MIN_SESSION_SECRET_LENGTH) {
      throw new Error(
        `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters long in production. ` +
        "Generate a secure secret with: openssl rand -base64 32"
      );
    }
  }

  return finalSecret;
}

function resolveAdminCredentials() {
  const rawUsername = process.env.ADMIN_USERNAME ?? null;
  const rawPassword = process.env.ADMIN_PASSWORD ?? null;
  const username = rawUsername?.trim() || DEFAULT_ADMIN_USERNAME;
  const password = rawPassword?.trim() || DEFAULT_ADMIN_PASSWORD;

  // In development, allow defaults
  if (isDevelopment) {
    if (username === DEFAULT_ADMIN_USERNAME || password === DEFAULT_ADMIN_PASSWORD) {
      console.log("Using default admin credentials for development (admin/admin)");
    }
    return { username, password };
  }

  // In production build phase, allow defaults temporarily
  if (isProduction && !isNodeRuntime) {
    return { username, password };
  }

  // Strict validation in production runtime
  if (isRuntimeProduction) {
    const errors: string[] = [];

    // Username validation - just ensure it's set
    if (!rawUsername || !username) {
      errors.push(
        "ADMIN_USERNAME must be set"
      );
    }

    // Password validation - strict requirements
    if (!rawPassword || password === DEFAULT_ADMIN_PASSWORD) {
      errors.push(
        "ADMIN_PASSWORD must be set to a custom value in production (not 'admin')"
      );
    } else {
      if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
        errors.push(
          `ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long`
        );
      }
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
        errors.push(
          "ADMIN_PASSWORD must include both uppercase and lowercase letters"
        );
      }
      if (!/[0-9]/.test(password)) {
        errors.push(
          "ADMIN_PASSWORD must include at least one number"
        );
      }
      if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push(
          "ADMIN_PASSWORD must include at least one special character"
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(
        "Admin credentials validation failed:\n" +
        errors.map(e => `  - ${e}`).join("\n") +
        "\n\nSet secure credentials using ADMIN_USERNAME and ADMIN_PASSWORD environment variables."
      );
    }
  }

  return { username, password };
}

// Lazy initialization to avoid executing during build time
let _adminCredentials: { username: string; password: string } | null = null;
let _sessionSecret: string | null = null;

function getAdminCredentials() {
  if (!_adminCredentials) {
    _adminCredentials = resolveAdminCredentials();
  }
  return _adminCredentials;
}

function getSessionSecret() {
  if (!_sessionSecret) {
    _sessionSecret = resolveSessionSecret();
  }
  return _sessionSecret;
}

export const config = {
  get sessionSecret() {
    return getSessionSecret();
  },
  caddyApiUrl: process.env.CADDY_API_URL ?? DEFAULT_CADDY_URL,
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  get adminUsername() {
    return getAdminCredentials().username;
  },
  get adminPassword() {
    return getAdminCredentials().password;
  },
  auth: {
    allowSelfRegistration: process.env.AUTH_ALLOW_SELF_REGISTRATION === "true",
    // Separate from credential self-registration: gates whether an OAuth
    // sign-in may implicitly create a brand-new account. Defaults to closed.
    allowOauthRegistration: process.env.AUTH_ALLOW_OAUTH_REGISTRATION === "true",
  },
  oauth: {
    enabled: process.env.OAUTH_ENABLED === "true",
    providerName: process.env.OAUTH_PROVIDER_NAME ?? "OAuth2",
    clientId: process.env.OAUTH_CLIENT_ID ?? null,
    clientSecret: process.env.OAUTH_CLIENT_SECRET ?? null,
    issuer: process.env.OAUTH_ISSUER ?? null,
    authorizationUrl: process.env.OAUTH_AUTHORIZATION_URL ?? null,
    tokenUrl: process.env.OAUTH_TOKEN_URL ?? null,
    userinfoUrl: process.env.OAUTH_USERINFO_URL ?? null,
    allowAutoLinking: process.env.OAUTH_ALLOW_AUTO_LINKING === "true",
  },
  forwardAuthInternalUrl: process.env.FORWARD_AUTH_INTERNAL_URL ?? null,
};

/**
 * Validates configuration at server startup in production.
 * Throws if production is running with insecure default values.
 * Safe to call during build - only validates when actually serving.
 */
export function validateProductionConfig() {
  if (isRuntimeProduction) {
    // Force validation by accessing the config values
    // This will throw if defaults are being used in production
    void config.sessionSecret;
    void config.adminUsername;
    void config.adminPassword;
  }
}

/**
 * Returns list of enabled OAuth providers based on configuration.
 * Only includes providers that have complete credentials configured.
 */
export function getEnabledOAuthProviders(): Array<{id: string; name: string}> {
  const providers: Array<{id: string; name: string}> = [];

  if (
    config.oauth.enabled &&
    config.oauth.clientId &&
    config.oauth.clientSecret &&
    config.oauth.issuer
  ) {
    providers.push({
      id: "oauth2",
      name: config.oauth.providerName
    });
  }

  return providers;
}
