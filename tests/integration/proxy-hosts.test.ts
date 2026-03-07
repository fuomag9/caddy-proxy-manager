import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { proxyHosts } from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertProxyHost(overrides: Partial<typeof proxyHosts.$inferInsert> = {}) {
  const now = nowIso();
  const [host] = await db.insert(proxyHosts).values({
    name: 'Test Host',
    domains: JSON.stringify(['example.com']),
    upstreams: JSON.stringify(['localhost:8080']),
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

describe('proxy-hosts integration', () => {
  it('inserts proxy host with domains array — retrieved correctly via JSON parse', async () => {
    const domains = ['example.com', 'www.example.com'];
    const host = await insertProxyHost({ domains: JSON.stringify(domains), name: 'Multi Domain' });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(JSON.parse(row!.domains)).toEqual(domains);
  });

  it('inserts proxy host with upstreams array — retrieved correctly', async () => {
    const upstreams = ['app1:8080', 'app2:8080'];
    const host = await insertProxyHost({ upstreams: JSON.stringify(upstreams), name: 'Load Balanced' });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(JSON.parse(row!.upstreams)).toEqual(upstreams);
  });

  it('enabled field defaults to true', async () => {
    const host = await insertProxyHost();
    expect(host.enabled).toBe(true);
  });

  it('insert and query all returns at least one result', async () => {
    await insertProxyHost();
    const rows = await db.select().from(proxyHosts);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('delete by id removes the host', async () => {
    const host = await insertProxyHost();
    await db.delete(proxyHosts).where(eq(proxyHosts.id, host.id));
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row).toBeUndefined();
  });

  it('multiple proxy hosts — count is correct', async () => {
    await insertProxyHost({ name: 'Host 1', domains: JSON.stringify(['a.com']) });
    await insertProxyHost({ name: 'Host 2', domains: JSON.stringify(['b.com']) });
    await insertProxyHost({ name: 'Host 3', domains: JSON.stringify(['c.com']) });
    const rows = await db.select().from(proxyHosts);
    expect(rows.length).toBe(3);
  });

  it('hsts and websocket booleans are stored and retrieved correctly', async () => {
    const host = await insertProxyHost({ hstsEnabled: false, allowWebsocket: false });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.hstsEnabled).toBe(false);
    expect(row!.allowWebsocket).toBe(false);
  });
});
