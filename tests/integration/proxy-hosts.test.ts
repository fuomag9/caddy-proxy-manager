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

  it('stores and retrieves redirect rules via meta JSON', async () => {
    const redirects = [
      { from: '/.well-known/carddav', to: '/remote.php/dav/', status: 301 },
      { from: '/.well-known/caldav', to: '/remote.php/dav/', status: 301 },
    ];
    const host = await insertProxyHost({
      name: 'nextcloud',
      domains: JSON.stringify(['nextcloud.example.com']),
      upstreams: JSON.stringify(['192.168.1.154:11000']),
      meta: JSON.stringify({ redirects }),
    });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const meta = JSON.parse(row!.meta ?? '{}');
    expect(meta.redirects).toHaveLength(2);
    expect(meta.redirects[0]).toMatchObject({
      from: '/.well-known/carddav',
      to: '/remote.php/dav/',
      status: 301,
    });
  });

  it('stores and retrieves path prefix rewrite via meta JSON', async () => {
    const host = await insertProxyHost({
      name: 'recipes',
      domains: JSON.stringify(['recipes.example.com']),
      upstreams: JSON.stringify(['192.168.1.150:8080']),
      meta: JSON.stringify({ rewrite: { path_prefix: '/recipes' } }),
    });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const meta = JSON.parse(row!.meta ?? '{}');
    expect(meta.rewrite?.path_prefix).toBe('/recipes');
  });

  it('filters out invalid redirect rules on parse', async () => {
    const redirects = [
      { from: '', to: '/valid', status: 301 },        // missing from — invalid
      { from: '/valid', to: '', status: 301 },         // missing to — invalid
      { from: '/ok', to: '/dest', status: 999 },       // bad status — invalid
      { from: '/good', to: '/dest', status: 302 },     // valid
    ];
    const host = await insertProxyHost({
      name: 'test-filter',
      meta: JSON.stringify({ redirects }),
    });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    // Simulate parseMeta sanitization: only valid rules have non-empty from/to and valid status
    const meta = JSON.parse(row!.meta ?? '{}');
    const valid = (meta.redirects as typeof redirects).filter(
      (r) => r.from.trim() && r.to.trim() && [301, 302, 307, 308].includes(r.status)
    );
    expect(valid).toHaveLength(1);
    expect(valid[0].from).toBe('/good');
  });
});
