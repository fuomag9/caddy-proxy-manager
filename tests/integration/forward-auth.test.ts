import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createTestDb, type TestDb } from '../helpers/db';
import {
  forwardAuthSessions,
  forwardAuthExchanges,
  forwardAuthAccess,
  groups,
  groupMembers,
  users,
  proxyHosts
} from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

function futureIso(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function pastIso(seconds: number) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const now = nowIso();
  const [user] = await db.insert(users).values({
    email: `user${Math.random().toString(36).slice(2)}@localhost`,
    name: 'Test User',
    role: 'user',
    provider: 'credentials',
    subject: `test-${Date.now()}-${Math.random()}`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return user;
}

async function insertProxyHost(overrides: Partial<typeof proxyHosts.$inferInsert> = {}) {
  const now = nowIso();
  const [host] = await db.insert(proxyHosts).values({
    name: 'Test Host',
    domains: JSON.stringify(['app.example.com']),
    upstreams: JSON.stringify(['backend:8080']),
    sslForced: true,
    hstsEnabled: true,
    hstsSubdomains: false,
    allowWebsocket: true,
    preserveHostHeader: true,
    skipHttpsHostnameValidation: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return host;
}

describe('forward auth sessions', () => {
  it('creates a session with hashed token', async () => {
    const user = await insertUser();
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const now = nowIso();

    const [session] = await db.insert(forwardAuthSessions).values({
      userId: user.id,
      tokenHash,
      expiresAt: futureIso(3600),
      createdAt: now,
    }).returning();

    expect(session.tokenHash).toBe(tokenHash);
    expect(session.userId).toBe(user.id);
  });

  it('enforces unique token hashes', async () => {
    const user = await insertUser();
    const tokenHash = hashToken('same-token');
    const now = nowIso();

    await db.insert(forwardAuthSessions).values({
      userId: user.id, tokenHash, expiresAt: futureIso(3600), createdAt: now,
    });

    await expect(
      db.insert(forwardAuthSessions).values({
        userId: user.id, tokenHash, expiresAt: futureIso(3600), createdAt: now,
      })
    ).rejects.toThrow();
  });

  it('cascades user deletion to sessions', async () => {
    const user = await insertUser();
    const now = nowIso();

    await db.insert(forwardAuthSessions).values({
      userId: user.id,
      tokenHash: hashToken('token1'),
      expiresAt: futureIso(3600),
      createdAt: now,
    });

    await db.delete(users).where(eq(users.id, user.id));

    const sessions = await db.query.forwardAuthSessions.findMany();
    expect(sessions).toHaveLength(0);
  });
});

describe('forward auth exchanges', () => {
  it('creates an exchange code linked to a session', async () => {
    const user = await insertUser();
    const now = nowIso();

    const [session] = await db.insert(forwardAuthSessions).values({
      userId: user.id,
      tokenHash: hashToken('session-token'),
      expiresAt: futureIso(3600),
      createdAt: now,
    }).returning();

    const rawCode = randomBytes(32).toString('hex');
    const [exchange] = await db.insert(forwardAuthExchanges).values({
      sessionId: session.id,
      codeHash: hashToken(rawCode),
      sessionToken: 'raw-session-token',
      redirectUri: 'https://app.example.com/path',
      expiresAt: futureIso(60),
      used: false,
      createdAt: now,
    }).returning();

    expect(exchange.sessionId).toBe(session.id);
    expect(exchange.sessionToken).toBe('raw-session-token');
    expect(exchange.used).toBe(false);
  });

  it('cascades session deletion to exchanges', async () => {
    const user = await insertUser();
    const now = nowIso();

    const [session] = await db.insert(forwardAuthSessions).values({
      userId: user.id,
      tokenHash: hashToken('session2'),
      expiresAt: futureIso(3600),
      createdAt: now,
    }).returning();

    await db.insert(forwardAuthExchanges).values({
      sessionId: session.id,
      codeHash: hashToken('code1'),
      sessionToken: 'raw-token',
      redirectUri: 'https://app.example.com/',
      expiresAt: futureIso(60),
      used: false,
      createdAt: now,
    });

    await db.delete(forwardAuthSessions).where(eq(forwardAuthSessions.id, session.id));

    const exchanges = await db.query.forwardAuthExchanges.findMany();
    expect(exchanges).toHaveLength(0);
  });
});

describe('forward auth access', () => {
  it('creates user-level access for a proxy host', async () => {
    const user = await insertUser();
    const host = await insertProxyHost();
    const now = nowIso();

    const [access] = await db.insert(forwardAuthAccess).values({
      proxyHostId: host.id,
      userId: user.id,
      groupId: null,
      createdAt: now,
    }).returning();

    expect(access.proxyHostId).toBe(host.id);
    expect(access.userId).toBe(user.id);
    expect(access.groupId).toBeNull();
  });

  it('creates group-level access for a proxy host', async () => {
    const host = await insertProxyHost();
    const now = nowIso();

    const [group] = await db.insert(groups).values({
      name: 'Devs',
      createdAt: now,
      updatedAt: now,
    }).returning();

    const [access] = await db.insert(forwardAuthAccess).values({
      proxyHostId: host.id,
      userId: null,
      groupId: group.id,
      createdAt: now,
    }).returning();

    expect(access.groupId).toBe(group.id);
    expect(access.userId).toBeNull();
  });

  it('prevents duplicate user access per host', async () => {
    const user = await insertUser();
    const host = await insertProxyHost();
    const now = nowIso();

    await db.insert(forwardAuthAccess).values({
      proxyHostId: host.id, userId: user.id, groupId: null, createdAt: now,
    });

    await expect(
      db.insert(forwardAuthAccess).values({
        proxyHostId: host.id, userId: user.id, groupId: null, createdAt: now,
      })
    ).rejects.toThrow();
  });

  it('cascades proxy host deletion to access entries', async () => {
    const user = await insertUser();
    const host = await insertProxyHost();
    const now = nowIso();

    await db.insert(forwardAuthAccess).values({
      proxyHostId: host.id, userId: user.id, groupId: null, createdAt: now,
    });

    await db.delete(proxyHosts).where(eq(proxyHosts.id, host.id));

    const access = await db.query.forwardAuthAccess.findMany();
    expect(access).toHaveLength(0);
  });

  it('cascades group deletion to access entries', async () => {
    const host = await insertProxyHost();
    const now = nowIso();

    const [group] = await db.insert(groups).values({
      name: 'Team', createdAt: now, updatedAt: now,
    }).returning();

    await db.insert(forwardAuthAccess).values({
      proxyHostId: host.id, userId: null, groupId: group.id, createdAt: now,
    });

    await db.delete(groups).where(eq(groups.id, group.id));

    const access = await db.query.forwardAuthAccess.findMany();
    expect(access).toHaveLength(0);
  });

  it('allows both user and group access on same host', async () => {
    const user = await insertUser();
    const host = await insertProxyHost();
    const now = nowIso();

    const [group] = await db.insert(groups).values({
      name: 'Group', createdAt: now, updatedAt: now,
    }).returning();

    await db.insert(forwardAuthAccess).values([
      { proxyHostId: host.id, userId: user.id, groupId: null, createdAt: now },
      { proxyHostId: host.id, userId: null, groupId: group.id, createdAt: now },
    ]);

    const access = await db.query.forwardAuthAccess.findMany({
      where: (t, { eq }) => eq(t.proxyHostId, host.id),
    });
    expect(access).toHaveLength(2);
  });
});
