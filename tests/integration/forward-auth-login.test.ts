/**
 * Forward-auth portal login: the redirect intent is checked before the
 * credentials, unknown and known users are rejected the same way, oversized
 * input is refused up front, and the limiters work per client, per (account,
 * client) and per account without letting third parties lock a user out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => {
  // Vite exposes BASE_URL="/" to tests; the route needs an absolute origin.
  process.env.BASE_URL = 'http://localhost:3000';
  return { db: null as unknown as TestDb };
});

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

import * as schema from '../../src/lib/db/schema';
import { createRedirectIntent } from '../../src/lib/models/forward-auth';
import { POST as forwardAuthLogin } from '../../app/api/forward-auth/login/route';
import { config } from '../../src/lib/config';
import { ACCOUNT_FAILURE_CEILING } from '../../src/lib/forward-auth-login-limiter';

const PASSWORD = 'Correct-Horse-9!';
const now = () => new Date().toISOString();
let hostId = 0;

async function insertUser(
  username: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {}
) {
  const timestamp = now();
  const [user] = await ctx.db.insert(schema.users).values({
    email: `${username}@localhost`,
    name: username,
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    role: 'user',
    provider: 'credentials',
    subject: username,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }).returning();
  await ctx.db.insert(schema.forwardAuthAccess).values({
    proxyHostId: hostId, userId: user.id, groupId: null, createdAt: timestamp,
  });
  return user;
}

function baseOrigin(): string {
  return new URL(config.baseUrl).origin;
}

// The limiters live for the whole file, so each test gets its own client address.
let testIpCounter = 0;
let clientIp = '';

function loginRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/forward-auth/login', {
    method: 'POST',
    headers: {
      origin: baseOrigin(),
      'content-type': 'application/json',
      'x-forwarded-for': clientIp,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function intent() {
  return createRedirectIntent('https://app.example.com/');
}

async function login(username: string, password: string, headers: Record<string, string> = {}) {
  return forwardAuthLogin(loginRequest({ username, password, rid: await intent() }, headers));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  testIpCounter += 1;
  clientIp = `192.0.2.${testIpCounter}`;
  await ctx.db.delete(schema.forwardAuthAccess);
  await ctx.db.delete(schema.forwardAuthRedirectIntents);
  await ctx.db.delete(schema.accounts);
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.users);
  const timestamp = now();
  const [host] = await ctx.db.insert(schema.proxyHosts).values({
    name: 'App',
    domains: JSON.stringify(['app.example.com']),
    upstreams: JSON.stringify(['backend:8080']),
    sslForced: true,
    hstsEnabled: true,
    hstsSubdomains: false,
    allowWebsocket: true,
    preserveHostHeader: true,
    skipHttpsHostnameValidation: false,
    enabled: true,
    meta: JSON.stringify({ cpm_forward_auth: { enabled: true } }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning();
  hostId = host.id;
});

describe('forward-auth login', () => {
  it('rejects an unusable intent identically whether or not the password is right', async () => {
    await insertUser('alice');
    const right = await forwardAuthLogin(loginRequest({ username: 'alice', password: PASSWORD, rid: 'bogus' }));
    const wrong = await forwardAuthLogin(loginRequest({ username: 'alice', password: 'nope', rid: 'bogus' }));
    expect(right.status).toBe(400);
    expect(wrong.status).toBe(400);
    expect(await right.json()).toEqual(await wrong.json());
  });

  it('rejects unknown users and wrong passwords the same way, and accepts the right password', async () => {
    await insertUser('bob');
    const unknown = await forwardAuthLogin(
      loginRequest({ username: 'nobody', password: PASSWORD, rid: await createRedirectIntent('https://app.example.com/') })
    );
    const wrong = await forwardAuthLogin(
      loginRequest({ username: 'bob', password: 'nope', rid: await createRedirectIntent('https://app.example.com/') })
    );
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());

    const ok = await forwardAuthLogin(
      loginRequest({ username: 'bob', password: PASSWORD, rid: await createRedirectIntent('https://app.example.com/x') })
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).redirectTo).toMatch(/^https:\/\/app\.example\.com\/\.cpm-auth\/callback\?code=/);
  });

  it('accepts a password kept only on the credential account (self-registered users)', async () => {
    const user = await insertUser('frank', { passwordHash: null });
    await ctx.db.insert(schema.accounts).values({
      userId: user.id, accountId: String(user.id), providerId: 'credential',
      password: bcrypt.hashSync(PASSWORD, 4), createdAt: now(), updatedAt: now(),
    });
    expect((await login('frank', 'nope')).status).toBe(401);
    expect((await login('frank', PASSWORD)).status).toBe(200);
  });

  it('runs exactly one bcrypt compare for unknown, inactive and password-less users', async () => {
    await insertUser('dave', { status: 'disabled' });
    await insertUser('erin', { passwordHash: null, provider: 'oidc' });
    const compare = vi.spyOn(bcrypt, 'compare');

    for (const username of ['nobody', 'dave', 'erin']) {
      compare.mockClear();
      const res = await login(username, PASSWORD);
      expect(res.status).toBe(401);
      expect(compare).toHaveBeenCalledTimes(1);
      // Same cost as real account hashes, so the rejection takes as long.
      expect(compare.mock.calls[0][1]).toMatch(/^\$2[aby]\$12\$/);
    }
  });

  it('refuses usernames over 256 characters before any credential work', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const res = await login('a'.repeat(257), PASSWORD);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Username is too long' });
    expect(compare).not.toHaveBeenCalled();

    // 256 characters is still an ordinary (failed) login.
    expect((await login('a'.repeat(256), 'nope')).status).toBe(401);
  });

  it('refuses oversized bodies whether or not Content-Length is declared', async () => {
    await insertUser('frank');
    const rid = await intent();
    const padding = 'x'.repeat(20 * 1024);

    const declared = await forwardAuthLogin(
      loginRequest({ username: 'frank', password: PASSWORD, rid, padding }, { 'content-length': String(20 * 1024 + 80) })
    );
    expect(declared.status).toBe(413);

    const undeclared = loginRequest({ username: 'frank', password: PASSWORD, rid, padding });
    expect(undeclared.headers.get('content-length')).toBeNull();
    expect((await forwardAuthLogin(undeclared)).status).toBe(413);

    // The intent was not spent, and a normal-sized body still works.
    const ok = await forwardAuthLogin(loginRequest({ username: 'frank', password: PASSWORD, rid }));
    expect(ok.status).toBe(200);
  });

  it('does not let other clients lock an account out with a few failures', async () => {
    await insertUser('carol');
    for (let i = 0; i < 5; i++) {
      const res = await login('carol', `wrong-${i}`, { 'x-forwarded-for': `203.0.113.${i}` });
      expect(res.status).toBe(401);
    }
    const ok = await login('carol', PASSWORD, { 'x-forwarded-for': '203.0.113.99' });
    expect(ok.status).toBe(200);
  });

  it('blocks an account once failures from all clients reach the ceiling', async () => {
    await insertUser('grace');
    const rid = await intent();
    for (let i = 0; i < ACCOUNT_FAILURE_CEILING; i++) {
      const res = await forwardAuthLogin(
        loginRequest({ username: 'grace', password: `wrong-${i}`, rid }, { 'x-forwarded-for': `10.1.${i >> 8}.${i & 255}` })
      );
      expect(res.status).toBe(401);
    }
    const blocked = await login('grace', PASSWORD, { 'x-forwarded-for': '10.2.0.1' });
    expect(blocked.status).toBe(429);
  });

  it('limits one client per account even after it signs in to its own account', async () => {
    await insertUser('heidi');
    await insertUser('mallory');
    for (let i = 0; i < 4; i++) {
      expect((await login('heidi', `wrong-${i}`)).status).toBe(401);
    }
    // Signing in clears the client's IP counter...
    expect((await login('mallory', PASSWORD)).status).toBe(200);
    // ...but not its failures against heidi: the fifth one blocks that pair.
    expect((await login('heidi', 'wrong-4')).status).toBe(401);
    expect((await login('heidi', PASSWORD)).status).toBe(429);

    // The client can still use its own account, and heidi can sign in elsewhere.
    expect((await login('mallory', PASSWORD)).status).toBe(200);
    expect((await login('heidi', PASSWORD, { 'x-forwarded-for': '198.51.100.200' })).status).toBe(200);
  });

  it('limits a client across accounts by the rightmost X-Forwarded-For entry, ignoring X-Real-IP', async () => {
    await insertUser('ivan');
    for (let i = 0; i < 5; i++) {
      const res = await login(`spray-${i}`, 'wrong', {
        'x-real-ip': `198.51.100.${i}`,
        'x-forwarded-for': `203.0.113.${i}, ${clientIp}`,
      });
      expect(res.status).toBe(401);
    }
    const blocked = await login('ivan', PASSWORD, { 'x-real-ip': '198.51.100.99', 'x-forwarded-for': `203.0.113.99, ${clientIp}` });
    expect(blocked.status).toBe(429);
  });

  it('counts concurrent attempts from one client against its limit', async () => {
    await insertUser('kate');
    const rids = await Promise.all(Array.from({ length: 12 }, () => intent()));
    const responses = await Promise.all(
      rids.map((rid, i) => forwardAuthLogin(loginRequest({ username: 'kate', password: `wrong-${i}`, rid })))
    );
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
    expect((await login('kate', PASSWORD)).status).toBe(429);
  });

  it('counts concurrent attempts from all clients against the account ceiling', async () => {
    await insertUser('leo');
    const rid = await intent();
    const responses = await Promise.all(
      Array.from({ length: ACCOUNT_FAILURE_CEILING + 10 }, (_, i) =>
        forwardAuthLogin(
          loginRequest({ username: 'leo', password: `wrong-${i}`, rid }, { 'x-forwarded-for': `10.3.${i >> 8}.${i & 255}` })
        )
      )
    );
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(ACCOUNT_FAILURE_CEILING);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10);
    expect((await login('leo', PASSWORD, { 'x-forwarded-for': '10.4.0.1' })).status).toBe(429);
  });

  it('does not count an attempt that failed with an error', async () => {
    await insertUser('mike');
    vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await login('mike', 'wrong')).status).toBe(500);
    // Four failures plus a leaked in-flight attempt would reach the limit of 5.
    for (let i = 0; i < 4; i++) {
      expect((await login('mike', `wrong-${i}`)).status).toBe(401);
    }
    expect((await login('mike', PASSWORD)).status).toBe(200);
  });

  it('limits an IPv6 client by its /64 prefix', async () => {
    await insertUser('nina');
    for (let i = 0; i < 5; i++) {
      const res = await login(`spray-${i}`, 'wrong', { 'x-forwarded-for': `2001:db8:${testIpCounter}:7::${i + 1}` });
      expect(res.status).toBe(401);
    }
    const blocked = await login('nina', PASSWORD, { 'x-forwarded-for': `2001:db8:${testIpCounter}:7:ffff::9` });
    expect(blocked.status).toBe(429);
    const otherPrefix = await login('nina', PASSWORD, { 'x-forwarded-for': `2001:db8:${testIpCounter}:8::1` });
    expect(otherPrefix.status).toBe(200);
  });

  it('keys clients on TRUSTED_CLIENT_IP_HEADER when it is set', async () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'X-Real-IP');
    await insertUser('judy');
    for (let i = 0; i < 5; i++) {
      const res = await login(`spray-${i}`, 'wrong', { 'x-real-ip': clientIp, 'x-forwarded-for': `203.0.113.${i}` });
      expect(res.status).toBe(401);
    }
    const blocked = await login('judy', PASSWORD, { 'x-real-ip': clientIp, 'x-forwarded-for': '203.0.113.50' });
    expect(blocked.status).toBe(429);
    const other = await login('judy', PASSWORD, { 'x-real-ip': '198.51.100.77', 'x-forwarded-for': clientIp });
    expect(other.status).toBe(200);
  });
});
