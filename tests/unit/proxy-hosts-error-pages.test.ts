/**
 * Regression: per-host custom error pages must round-trip through
 * createProxyHost / updateProxyHost.
 *
 * Bug: serializeMeta did not copy `error_pages` into the stored meta JSON, so
 * a host created with errorPages persisted nothing — getProxyHost returned an
 * empty list and Caddy never emitted the per-host handle_errors route. Global
 * error pages (stored in settings, not host meta) were unaffected, which is why
 * only the per-host functional e2e tests failed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

vi.mock('../../src/lib/caddy', () => ({
  applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../src/lib/audit', () => ({
  logAuditEvent: vi.fn(),
}));

import {
  createProxyHost,
  updateProxyHost,
  getProxyHost,
  type ProxyHostInput,
} from '../../src/lib/models/proxy-hosts';
import * as schema from '../../src/lib/db/schema';

beforeEach(async () => {
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.users).catch(() => {});
  await ctx.db.insert(schema.users).values({
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    provider: 'credentials',
    subject: 'test',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

const baseInput = (overrides: Partial<ProxyHostInput> = {}): ProxyHostInput => ({
  name: 'err-host',
  domains: ['err.example.com'],
  upstreams: ['10.0.0.5:8080'],
  ...overrides,
});

async function rawMeta(id: number): Promise<Record<string, unknown> | null> {
  const row = await ctx.db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  return row?.meta ? JSON.parse(row.meta) : null;
}

describe('proxy host error_pages persistence', () => {
  it('persists errorPages on create and exposes them via getProxyHost', async () => {
    const errorPages = [
      { statuses: [502, 503, 504], body: '<h1>Maintenance</h1>' },
      { statuses: [], body: 'CATCH_ALL', contentType: 'text/plain; charset=utf-8' },
    ];
    const host = await createProxyHost(baseInput({ errorPages }), 1);

    const fetched = await getProxyHost(host.id);
    expect(fetched?.errorPages).toEqual(errorPages);

    // Catch normalization bugs at the storage layer too.
    expect((await rawMeta(host.id))?.error_pages).toEqual(errorPages);
  });

  it('omits error_pages from meta when no rules are provided', async () => {
    const host = await createProxyHost(baseInput(), 1);
    expect((await getProxyHost(host.id))?.errorPages).toEqual([]);
    const meta = await rawMeta(host.id);
    expect(meta == null || !('error_pages' in meta)).toBe(true);
  });

  it('adds error pages to a host that had none via update', async () => {
    const host = await createProxyHost(baseInput(), 1);
    expect((await getProxyHost(host.id))?.errorPages).toEqual([]);

    await updateProxyHost(host.id, { errorPages: [{ statuses: [404], body: 'NOPE' }] }, 1);
    expect((await getProxyHost(host.id))?.errorPages).toEqual([{ statuses: [404], body: 'NOPE' }]);
  });

  it('clears error pages when updated with an empty list', async () => {
    const host = await createProxyHost(baseInput({ errorPages: [{ statuses: [], body: 'X' }] }), 1);
    expect((await getProxyHost(host.id))?.errorPages).toHaveLength(1);

    await updateProxyHost(host.id, { errorPages: [] }, 1);
    expect((await getProxyHost(host.id))?.errorPages).toEqual([]);
    const meta = await rawMeta(host.id);
    expect(meta == null || !('error_pages' in meta)).toBe(true);
  });

  it('sanitizes rules on the way in (drops bodiless rules, filters bad statuses, strips CRLF)', async () => {
    const host = await createProxyHost(
      baseInput({
        errorPages: [
          { statuses: [200, 502, 700], body: 'KEEP' },          // 200/700 out of range → dropped
          { statuses: [500], body: '' },                          // no body → whole rule dropped
          { statuses: [404], body: 'CT', contentType: 'text/html\r\nX-Evil: 1' }, // CRLF stripped
        ],
      }),
      1,
    );
    const fetched = await getProxyHost(host.id);
    expect(fetched?.errorPages).toEqual([
      { statuses: [502], body: 'KEEP' },
      { statuses: [404], body: 'CT', contentType: 'text/htmlX-Evil: 1' },
    ]);
  });
});
