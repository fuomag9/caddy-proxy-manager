/**
 * Forward-auth portal login: the redirect intent is checked before the
 * credentials, unknown and known users are rejected the same way, and the
 * limiter cannot be sidestepped by rotating client-supplied IP headers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const PASSWORD = 'Correct-Horse-9!';
const now = () => new Date().toISOString();
let hostId = 0;

async function insertUser(username: string) {
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
  }).returning();
  await ctx.db.insert(schema.forwardAuthAccess).values({
    proxyHostId: hostId, userId: user.id, groupId: null, createdAt: timestamp,
  });
  return user;
}

function baseOrigin(): string {
  return new URL(config.baseUrl).origin;
}

function loginRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/forward-auth/login', {
    method: 'POST',
    headers: { origin: baseOrigin(), 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await ctx.db.delete(schema.forwardAuthAccess);
  await ctx.db.delete(schema.forwardAuthRedirectIntents);
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

  it('keeps limiting an account while the client rotates IP headers', async () => {
    await insertUser('carol');
    for (let i = 0; i < 5; i++) {
      const res = await forwardAuthLogin(
        loginRequest(
          { username: 'carol', password: `wrong-${i}`, rid: await createRedirectIntent('https://app.example.com/') },
          { 'x-real-ip': `198.51.100.${i}`, 'x-forwarded-for': `203.0.113.${i}` }
        )
      );
      expect(res.status).toBe(401);
    }
    const blocked = await forwardAuthLogin(
      loginRequest(
        { username: 'carol', password: PASSWORD, rid: await createRedirectIntent('https://app.example.com/') },
        { 'x-real-ip': '198.51.100.99', 'x-forwarded-for': '203.0.113.99' }
      )
    );
    expect(blocked.status).toBe(429);
  });
});
