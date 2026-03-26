import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { apiTokens, users } from '@/src/lib/db/schema';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const now = nowIso();
  const [user] = await db.insert(users).values({
    email: 'admin@localhost',
    name: 'Admin',
    passwordHash: 'hash123',
    role: 'admin',
    provider: 'credentials',
    subject: 'admin@localhost',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return user;
}

async function insertApiToken(createdBy: number, overrides: Partial<typeof apiTokens.$inferInsert> = {}) {
  const now = nowIso();
  const rawToken = 'test-token-' + Math.random().toString(36).slice(2);
  const tokenHash = hashToken(rawToken);
  const [token] = await db.insert(apiTokens).values({
    name: 'Test Token',
    tokenHash,
    createdBy,
    createdAt: now,
    ...overrides,
  }).returning();
  return { token, rawToken };
}

describe('api-tokens integration', () => {
  it('inserts an api token and retrieves it by hash', async () => {
    const user = await insertUser();
    const { token, rawToken } = await insertApiToken(user.id);

    const hash = hashToken(rawToken);
    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.tokenHash, hash),
    });

    expect(row).toBeDefined();
    expect(row!.id).toBe(token.id);
    expect(row!.name).toBe('Test Token');
    expect(row!.createdBy).toBe(user.id);
  });

  it('stored hash matches SHA-256 of raw token', async () => {
    const user = await insertUser();
    const { token, rawToken } = await insertApiToken(user.id);

    const expectedHash = hashToken(rawToken);
    expect(token.tokenHash).toBe(expectedHash);
  });

  it('different raw tokens produce different hashes', async () => {
    const user = await insertUser();
    const t1 = await insertApiToken(user.id, { name: 'Token 1' });
    const t2 = await insertApiToken(user.id, { name: 'Token 2' });

    expect(t1.token.tokenHash).not.toBe(t2.token.tokenHash);
  });

  it('token lookup fails for wrong hash', async () => {
    const user = await insertUser();
    await insertApiToken(user.id);

    const wrongHash = hashToken('wrong-token');
    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.tokenHash, wrongHash),
    });

    expect(row).toBeUndefined();
  });

  it('expired token is detectable', async () => {
    const user = await insertUser();
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    const { token } = await insertApiToken(user.id, { expiresAt: pastDate });

    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.id, token.id),
    });

    expect(row).toBeDefined();
    expect(new Date(row!.expiresAt!).getTime()).toBeLessThan(Date.now());
  });

  it('non-expired token has future expiry', async () => {
    const user = await insertUser();
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // 1 day from now
    const { token } = await insertApiToken(user.id, { expiresAt: futureDate });

    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.id, token.id),
    });

    expect(row).toBeDefined();
    expect(new Date(row!.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('deleting a token removes it from the database', async () => {
    const user = await insertUser();
    const { token } = await insertApiToken(user.id);

    await db.delete(apiTokens).where(eq(apiTokens.id, token.id));

    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.id, token.id),
    });
    expect(row).toBeUndefined();
  });

  it('cascade deletes tokens when user is deleted', async () => {
    const user = await insertUser();
    const { token } = await insertApiToken(user.id);

    await db.delete(users).where(eq(users.id, user.id));

    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.id, token.id),
    });
    expect(row).toBeUndefined();
  });

  it('lastUsedAt is initially null', async () => {
    const user = await insertUser();
    const { token } = await insertApiToken(user.id);

    expect(token.lastUsedAt).toBeNull();
  });

  it('lastUsedAt can be updated', async () => {
    const user = await insertUser();
    const { token } = await insertApiToken(user.id);

    const now = nowIso();
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, token.id));

    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.id, token.id),
    });
    expect(row!.lastUsedAt).toBe(now);
  });

  it('unique index prevents duplicate token hashes', async () => {
    const user = await insertUser();
    const { token } = await insertApiToken(user.id);

    await expect(
      db.insert(apiTokens).values({
        name: 'Duplicate',
        tokenHash: token.tokenHash,
        createdBy: user.id,
        createdAt: nowIso(),
      })
    ).rejects.toThrow();
  });

  it('lists tokens for a specific user', async () => {
    const user1 = await insertUser({ email: 'u1@localhost', subject: 'u1@localhost' });
    const user2 = await insertUser({ email: 'u2@localhost', subject: 'u2@localhost' });

    await insertApiToken(user1.id, { name: 'User1 Token' });
    await insertApiToken(user2.id, { name: 'User2 Token' });

    const user1Tokens = await db.query.apiTokens.findMany({
      where: (t, { eq }) => eq(t.createdBy, user1.id),
    });
    expect(user1Tokens).toHaveLength(1);
    expect(user1Tokens[0].name).toBe('User1 Token');
  });

  it('token created by user A still exists after user B deletes own tokens', async () => {
    const userA = await insertUser({ email: 'a@localhost', subject: 'a@localhost' });
    const userB = await insertUser({ email: 'b@localhost', subject: 'b@localhost', role: 'user' });

    const { token: tokenA } = await insertApiToken(userA.id, { name: 'A Token' });
    const { token: tokenB } = await insertApiToken(userB.id, { name: 'B Token' });

    // User B deletes only their own tokens
    await db.delete(apiTokens).where(eq(apiTokens.createdBy, userB.id));

    const remainingTokens = await db.query.apiTokens.findMany();
    expect(remainingTokens).toHaveLength(1);
    expect(remainingTokens[0].id).toBe(tokenA.id);
  });

  it('admin can see all tokens regardless of creator', async () => {
    const admin = await insertUser({ email: 'admin2@localhost', subject: 'admin2@localhost', role: 'admin' });
    const user1 = await insertUser({ email: 'u3@localhost', subject: 'u3@localhost', role: 'user' });
    const user2 = await insertUser({ email: 'u4@localhost', subject: 'u4@localhost', role: 'user' });

    await insertApiToken(user1.id, { name: 'User1 Token' });
    await insertApiToken(user2.id, { name: 'User2 Token' });
    await insertApiToken(admin.id, { name: 'Admin Token' });

    const allTokens = await db.query.apiTokens.findMany();
    expect(allTokens).toHaveLength(3);
    const creators = allTokens.map(t => t.createdBy);
    expect(creators).toContain(user1.id);
    expect(creators).toContain(user2.id);
    expect(creators).toContain(admin.id);
  });

  it('inactive user token is discoverable but user status is inactive', async () => {
    const inactiveUser = await insertUser({
      email: 'inactive@localhost',
      subject: 'inactive@localhost',
      status: 'inactive',
    });
    const { token } = await insertApiToken(inactiveUser.id, { name: 'Inactive Token' });

    const row = await db.query.apiTokens.findFirst({
      where: (t, { eq }) => eq(t.id, token.id),
    });
    expect(row).toBeDefined();
    expect(row!.createdBy).toBe(inactiveUser.id);

    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, inactiveUser.id),
    });
    expect(user!.status).toBe('inactive');
  });
});
