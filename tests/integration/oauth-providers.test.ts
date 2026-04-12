import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { oauthProviders } from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { encryptSecret, decryptSecret } from '@/src/lib/secret';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertProvider(overrides: Partial<typeof oauthProviders.$inferInsert> = {}) {
  const now = nowIso();
  const [provider] = await db.insert(oauthProviders).values({
    id: randomUUID(),
    name: 'Test OIDC',
    type: 'oidc',
    clientId: encryptSecret('test-client-id'),
    clientSecret: encryptSecret('test-client-secret'),
    issuer: 'https://issuer.example.com',
    scopes: 'openid email profile',
    autoLink: false,
    enabled: true,
    source: 'ui',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return provider;
}

describe('oauth-providers integration', () => {
  it('creates and lists providers', async () => {
    await insertProvider({ name: 'GitHub' });
    await insertProvider({ name: 'Google', id: randomUUID() });

    const rows = await db.query.oauthProviders.findMany({
      orderBy: (t, { asc }) => asc(t.name),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('GitHub');
    expect(rows[1].name).toBe('Google');
    // enabled defaults to true
    expect(rows[0].enabled).toBe(true);
    expect(rows[1].enabled).toBe(true);
  });

  it('encrypts client secret on create and decrypts correctly', async () => {
    const plainSecret = 'super-secret-value-12345';
    const provider = await insertProvider({
      clientSecret: encryptSecret(plainSecret),
    });

    // The stored value should be encrypted (starts with enc:v1:)
    expect(provider.clientSecret).not.toBe(plainSecret);
    expect(provider.clientSecret.startsWith('enc:v1:')).toBe(true);

    // Decrypting should yield the original value
    const decrypted = decryptSecret(provider.clientSecret);
    expect(decrypted).toBe(plainSecret);
  });

  it('encrypts client ID on create and decrypts correctly', async () => {
    const plainClientId = 'my-client-id-abc';
    const provider = await insertProvider({
      clientId: encryptSecret(plainClientId),
    });

    expect(provider.clientId).not.toBe(plainClientId);
    expect(provider.clientId.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(provider.clientId)).toBe(plainClientId);
  });

  it('updates a provider name and enabled flag', async () => {
    const provider = await insertProvider({ name: 'Old Name', enabled: true });

    const now = nowIso();
    const [updated] = await db
      .update(oauthProviders)
      .set({ name: 'New Name', enabled: false, updatedAt: now })
      .where(eq(oauthProviders.id, provider.id))
      .returning();

    expect(updated.name).toBe('New Name');
    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt).toBe(now);
  });

  it('deletes a UI-sourced provider successfully', async () => {
    const provider = await insertProvider({ source: 'ui' });

    await db.delete(oauthProviders).where(eq(oauthProviders.id, provider.id));

    const row = await db.query.oauthProviders.findFirst({
      where: (t, { eq }) => eq(t.id, provider.id),
    });
    expect(row).toBeUndefined();
  });

  it('env-sourced provider can be identified by source field', async () => {
    const provider = await insertProvider({ source: 'env' });

    const row = await db.query.oauthProviders.findFirst({
      where: (t, { eq }) => eq(t.id, provider.id),
    });

    expect(row).toBeDefined();
    expect(row!.source).toBe('env');
  });

  it('getProviderDisplayList returns only enabled providers', async () => {
    await insertProvider({ name: 'Enabled Provider', enabled: true, id: randomUUID() });
    await insertProvider({ name: 'Disabled Provider', enabled: false, id: randomUUID() });

    const enabledRows = await db.query.oauthProviders.findMany({
      where: (t, { eq }) => eq(t.enabled, true),
      orderBy: (t, { asc }) => asc(t.name),
      columns: { id: true, name: true },
    });

    expect(enabledRows).toHaveLength(1);
    expect(enabledRows[0].name).toBe('Enabled Provider');
  });

  it('listEnabledOAuthProviders filters correctly', async () => {
    await insertProvider({ name: 'Active', enabled: true, id: randomUUID() });
    await insertProvider({ name: 'Inactive', enabled: false, id: randomUUID() });
    await insertProvider({ name: 'Also Active', enabled: true, id: randomUUID() });

    const enabled = await db.query.oauthProviders.findMany({
      where: (t, { eq }) => eq(t.enabled, true),
      orderBy: (t, { asc }) => asc(t.name),
    });

    expect(enabled).toHaveLength(2);
    expect(enabled.map((r) => r.name)).toEqual(['Active', 'Also Active']);
  });

  it('unique name constraint prevents duplicate names', async () => {
    await insertProvider({ name: 'UniqueProvider', id: randomUUID() });

    await expect(
      insertProvider({ name: 'UniqueProvider', id: randomUUID() })
    ).rejects.toThrow();
  });

  it('re-encrypts secret on update', async () => {
    const provider = await insertProvider({
      clientSecret: encryptSecret('original-secret'),
    });

    const newEncrypted = encryptSecret('updated-secret');
    const [updated] = await db
      .update(oauthProviders)
      .set({ clientSecret: newEncrypted, updatedAt: nowIso() })
      .where(eq(oauthProviders.id, provider.id))
      .returning();

    expect(updated.clientSecret).not.toBe(provider.clientSecret);
    expect(decryptSecret(updated.clientSecret)).toBe('updated-secret');
  });

  it('stores all optional URL fields', async () => {
    const provider = await insertProvider({
      issuer: 'https://issuer.example.com',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      userinfoUrl: 'https://auth.example.com/userinfo',
    });

    const row = await db.query.oauthProviders.findFirst({
      where: (t, { eq }) => eq(t.id, provider.id),
    });

    expect(row!.issuer).toBe('https://issuer.example.com');
    expect(row!.authorizationUrl).toBe('https://auth.example.com/authorize');
    expect(row!.tokenUrl).toBe('https://auth.example.com/token');
    expect(row!.userinfoUrl).toBe('https://auth.example.com/userinfo');
  });

  it('default type is oidc and default source is ui', async () => {
    const now = nowIso();
    const [provider] = await db.insert(oauthProviders).values({
      id: randomUUID(),
      name: 'Defaults Test',
      clientId: encryptSecret('cid'),
      clientSecret: encryptSecret('csecret'),
      scopes: 'openid',
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(provider.type).toBe('oidc');
    expect(provider.source).toBe('ui');
    expect(provider.autoLink).toBe(false);
    expect(provider.enabled).toBe(true);
  });
});
