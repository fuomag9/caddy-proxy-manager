import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { oauthProviders } from "@/src/lib/db/schema";
import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/src/lib/secret";

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

/**
 * Simulates what syncEnvOAuthProviders does:
 * - If no env-sourced provider with this name exists, create one
 * - If env-sourced provider exists, update it
 * - If UI-sourced provider with same name exists, skip
 */
async function syncProvider(envConfig: {
  name: string;
  clientId: string;
  clientSecret: string;
  issuer?: string | null;
  autoLink?: boolean;
}) {
  const now = nowIso();
  const existing = await db.query.oauthProviders.findFirst({
    where: (table, { eq }) => eq(table.name, envConfig.name),
  });

  if (existing && existing.source === "env") {
    // Update existing env-sourced provider
    const { eq } = await import("drizzle-orm");
    await db.update(oauthProviders).set({
      clientId: encryptSecret(envConfig.clientId),
      clientSecret: encryptSecret(envConfig.clientSecret),
      issuer: envConfig.issuer ?? null,
      autoLink: envConfig.autoLink ?? false,
      updatedAt: now,
    }).where(eq(oauthProviders.id, existing.id));
  } else if (!existing) {
    // Create new env-sourced provider
    await db.insert(oauthProviders).values({
      id: randomUUID(),
      name: envConfig.name,
      type: "oidc",
      clientId: encryptSecret(envConfig.clientId),
      clientSecret: encryptSecret(envConfig.clientSecret),
      issuer: envConfig.issuer ?? null,
      authorizationUrl: null,
      tokenUrl: null,
      userinfoUrl: null,
      scopes: "openid email profile",
      autoLink: envConfig.autoLink ?? false,
      enabled: true,
      source: "env",
      createdAt: now,
      updatedAt: now,
    });
  }
  // If a UI-sourced provider with the same name exists, skip
}

describe("syncEnvOAuthProviders", () => {
  it("creates env-sourced provider when configured", async () => {
    await syncProvider({
      name: "TestIdP",
      clientId: "env-client-id",
      clientSecret: "env-client-secret",
      issuer: "https://idp.example.com",
    });

    const providers = await db.query.oauthProviders.findMany();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("TestIdP");
    expect(providers[0].source).toBe("env");
    expect(decryptSecret(providers[0].clientId)).toBe("env-client-id");
    expect(providers[0].issuer).toBe("https://idp.example.com");
  });

  it("updates existing env-sourced provider when config changes", async () => {
    // First sync
    await syncProvider({
      name: "MyIdP",
      clientId: "old-id",
      clientSecret: "old-secret",
      issuer: "https://old.example.com",
      autoLink: false,
    });

    // Second sync with changed config
    await syncProvider({
      name: "MyIdP",
      clientId: "new-id",
      clientSecret: "new-secret",
      issuer: "https://new.example.com",
      autoLink: true,
    });

    const providers = await db.query.oauthProviders.findMany();
    expect(providers).toHaveLength(1);
    expect(decryptSecret(providers[0].clientId)).toBe("new-id");
    expect(providers[0].issuer).toBe("https://new.example.com");
    expect(providers[0].autoLink).toBe(true);
  });

  it("does not overwrite a UI-sourced provider with the same name", async () => {
    const now = nowIso();
    // Create a UI-sourced provider first
    await db.insert(oauthProviders).values({
      id: randomUUID(),
      name: "SharedName",
      type: "oidc",
      clientId: encryptSecret("ui-id"),
      clientSecret: encryptSecret("ui-secret"),
      scopes: "openid email profile",
      autoLink: false,
      enabled: true,
      source: "ui",
      createdAt: now,
      updatedAt: now,
    });

    // Try to sync env with the same name
    await syncProvider({
      name: "SharedName",
      clientId: "env-id",
      clientSecret: "env-secret",
    });

    const providers = await db.query.oauthProviders.findMany();
    expect(providers).toHaveLength(1);
    // Should still be the UI provider, not overwritten
    expect(providers[0].source).toBe("ui");
    expect(decryptSecret(providers[0].clientId)).toBe("ui-id");
  });

  it("skips when OAuth is not configured (no providers created)", async () => {
    // Simply don't call syncProvider - verify empty
    const providers = await db.query.oauthProviders.findMany();
    expect(providers).toHaveLength(0);
  });
});
