/**
 * Integration tests for src/lib/models/mtls-access-rules.ts
 * Tests all CRUD operations and the bulk query function.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import {
  mtlsAccessRules,
  proxyHosts,
  users,
} from '../../src/lib/db/schema';

let db: TestDb;

vi.mock('../../src/lib/db', async () => ({
  get default() { return db; },
  nowIso: () => new Date().toISOString(),
  toIso: (v: string | null) => v,
}));
vi.mock('../../src/lib/caddy', () => ({ applyCaddyConfig: vi.fn() }));
vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

let userId: number;

beforeEach(async () => {
  db = createTestDb();
  vi.clearAllMocks();
  const now = new Date().toISOString();
  const [user] = await db.insert(users).values({
    email: 'admin@test', name: 'Admin', role: 'admin',
    provider: 'credentials', subject: 'admin@test', status: 'active',
    createdAt: now, updatedAt: now,
  }).returning();
  userId = user.id;
});

function nowIso() { return new Date().toISOString(); }

async function insertHost(name = 'test-host') {
  const now = nowIso();
  const [host] = await db.insert(proxyHosts).values({
    name, domains: '["test.example.com"]', upstreams: '["http://localhost:8080"]',
    createdAt: now, updatedAt: now,
  }).returning();
  return host;
}

const {
  listMtlsAccessRules,
  getMtlsAccessRule,
  createMtlsAccessRule,
  updateMtlsAccessRule,
  deleteMtlsAccessRule,
  getAccessRulesForHosts,
} = await import('../../src/lib/models/mtls-access-rules');

describe('mtls-access-rules CRUD', () => {
  it('createMtlsAccessRule creates a rule', async () => {
    const host = await insertHost();
    const rule = await createMtlsAccessRule({
      proxyHostId: host.id,
      pathPattern: '/admin/*',
      allowedRoleIds: [1, 2],
      allowedCertIds: [10],
      priority: 5,
      description: 'admin only',
    }, userId);

    expect(rule.proxyHostId).toBe(host.id);
    expect(rule.pathPattern).toBe('/admin/*');
    expect(rule.allowedRoleIds).toEqual([1, 2]);
    expect(rule.allowedCertIds).toEqual([10]);
    expect(rule.priority).toBe(5);
    expect(rule.description).toBe('admin only');
    expect(rule.denyAll).toBe(false);
  });

  it('createMtlsAccessRule trims pathPattern', async () => {
    const host = await insertHost();
    const rule = await createMtlsAccessRule({
      proxyHostId: host.id,
      pathPattern: '  /api/*  ',
    }, userId);
    expect(rule.pathPattern).toBe('/api/*');
  });

  it('createMtlsAccessRule defaults arrays to empty', async () => {
    const host = await insertHost();
    const rule = await createMtlsAccessRule({
      proxyHostId: host.id,
      pathPattern: '*',
    }, userId);
    expect(rule.allowedRoleIds).toEqual([]);
    expect(rule.allowedCertIds).toEqual([]);
    expect(rule.denyAll).toBe(false);
    expect(rule.priority).toBe(0);
  });

  it('createMtlsAccessRule with denyAll', async () => {
    const host = await insertHost();
    const rule = await createMtlsAccessRule({
      proxyHostId: host.id,
      pathPattern: '/blocked/*',
      denyAll: true,
    }, userId);
    expect(rule.denyAll).toBe(true);
  });

  it('listMtlsAccessRules returns rules ordered by priority desc then path asc', async () => {
    const host = await insertHost();
    await createMtlsAccessRule({ proxyHostId: host.id, pathPattern: '/b', priority: 1 }, userId);
    await createMtlsAccessRule({ proxyHostId: host.id, pathPattern: '/a', priority: 10 }, userId);
    await createMtlsAccessRule({ proxyHostId: host.id, pathPattern: '/c', priority: 1 }, userId);

    const rules = await listMtlsAccessRules(host.id);
    expect(rules).toHaveLength(3);
    expect(rules[0].pathPattern).toBe('/a');    // priority 10 (highest)
    expect(rules[1].pathPattern).toBe('/b');    // priority 1, path /b
    expect(rules[2].pathPattern).toBe('/c');    // priority 1, path /c
  });

  it('listMtlsAccessRules returns empty array for host with no rules', async () => {
    const host = await insertHost();
    const rules = await listMtlsAccessRules(host.id);
    expect(rules).toEqual([]);
  });

  it('listMtlsAccessRules only returns rules for the specified host', async () => {
    const host1 = await insertHost('h1');
    const host2 = await insertHost('h2');
    await createMtlsAccessRule({ proxyHostId: host1.id, pathPattern: '/h1' }, userId);
    await createMtlsAccessRule({ proxyHostId: host2.id, pathPattern: '/h2' }, userId);

    const rules = await listMtlsAccessRules(host1.id);
    expect(rules).toHaveLength(1);
    expect(rules[0].pathPattern).toBe('/h1');
  });

  it('getMtlsAccessRule returns a single rule', async () => {
    const host = await insertHost();
    const created = await createMtlsAccessRule({
      proxyHostId: host.id, pathPattern: '/test',
    }, userId);

    const fetched = await getMtlsAccessRule(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.pathPattern).toBe('/test');
  });

  it('getMtlsAccessRule returns null for non-existent rule', async () => {
    expect(await getMtlsAccessRule(999)).toBeNull();
  });

  it('updateMtlsAccessRule updates fields', async () => {
    const host = await insertHost();
    const rule = await createMtlsAccessRule({
      proxyHostId: host.id, pathPattern: '/old', priority: 0,
    }, userId);

    const updated = await updateMtlsAccessRule(rule.id, {
      pathPattern: '/new',
      priority: 99,
      allowedRoleIds: [5],
      denyAll: true,
      description: 'updated',
    }, userId);

    expect(updated.pathPattern).toBe('/new');
    expect(updated.priority).toBe(99);
    expect(updated.allowedRoleIds).toEqual([5]);
    expect(updated.denyAll).toBe(true);
    expect(updated.description).toBe('updated');
  });

  it('updateMtlsAccessRule partial update leaves other fields unchanged', async () => {
    const host = await insertHost();
    const rule = await createMtlsAccessRule({
      proxyHostId: host.id, pathPattern: '/test',
      allowedRoleIds: [1], priority: 5, description: 'original',
    }, userId);

    const updated = await updateMtlsAccessRule(rule.id, { priority: 10 }, userId);
    expect(updated.pathPattern).toBe('/test');
    expect(updated.allowedRoleIds).toEqual([1]);
    expect(updated.description).toBe('original');
    expect(updated.priority).toBe(10);
  });

  it('updateMtlsAccessRule throws for non-existent rule', async () => {
    await expect(updateMtlsAccessRule(999, { priority: 1 }, 1)).rejects.toThrow();
  });

  it('deleteMtlsAccessRule removes the rule', async () => {
    const host = await insertHost();
    const rule = await createMtlsAccessRule({
      proxyHostId: host.id, pathPattern: '/test',
    }, userId);

    await deleteMtlsAccessRule(rule.id, 1);
    expect(await getMtlsAccessRule(rule.id)).toBeNull();
  });

  it('deleteMtlsAccessRule throws for non-existent rule', async () => {
    await expect(deleteMtlsAccessRule(999, 1)).rejects.toThrow();
  });
});

describe('getAccessRulesForHosts (bulk query)', () => {
  it('returns empty map for empty host list', async () => {
    const map = await getAccessRulesForHosts([]);
    expect(map.size).toBe(0);
  });

  it('returns empty map when no rules exist', async () => {
    const host = await insertHost();
    const map = await getAccessRulesForHosts([host.id]);
    expect(map.size).toBe(0);
  });

  it('groups rules by proxy host ID', async () => {
    const h1 = await insertHost('h1');
    const h2 = await insertHost('h2');
    await createMtlsAccessRule({ proxyHostId: h1.id, pathPattern: '/a' }, userId);
    await createMtlsAccessRule({ proxyHostId: h1.id, pathPattern: '/b' }, userId);
    await createMtlsAccessRule({ proxyHostId: h2.id, pathPattern: '/c' }, userId);

    const map = await getAccessRulesForHosts([h1.id, h2.id]);
    expect(map.get(h1.id)).toHaveLength(2);
    expect(map.get(h2.id)).toHaveLength(1);
  });

  it('excludes hosts not in the query list', async () => {
    const h1 = await insertHost('h1');
    const h2 = await insertHost('h2');
    await createMtlsAccessRule({ proxyHostId: h1.id, pathPattern: '/a' }, userId);
    await createMtlsAccessRule({ proxyHostId: h2.id, pathPattern: '/b' }, userId);

    const map = await getAccessRulesForHosts([h1.id]);
    expect(map.has(h1.id)).toBe(true);
    expect(map.has(h2.id)).toBe(false);
  });

  it('rules within a host are ordered by priority desc, path asc', async () => {
    const h = await insertHost();
    await createMtlsAccessRule({ proxyHostId: h.id, pathPattern: '/z', priority: 10 }, userId);
    await createMtlsAccessRule({ proxyHostId: h.id, pathPattern: '/a', priority: 1 }, userId);
    await createMtlsAccessRule({ proxyHostId: h.id, pathPattern: '/m', priority: 10 }, userId);

    const map = await getAccessRulesForHosts([h.id]);
    const rules = map.get(h.id)!;
    expect(rules[0].pathPattern).toBe('/m');  // priority 10, path /m
    expect(rules[1].pathPattern).toBe('/z');  // priority 10, path /z
    expect(rules[2].pathPattern).toBe('/a');  // priority 1
  });
});

describe('JSON parsing edge cases in access rules', () => {
  it('handles malformed allowedRoleIds JSON gracefully', async () => {
    const host = await insertHost();
    const now = nowIso();
    // Insert directly with bad JSON
    await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id, pathPattern: '/test',
      allowedRoleIds: 'not-json', allowedCertIds: '[]',
      createdAt: now, updatedAt: now,
    });

    const rules = await listMtlsAccessRules(host.id);
    expect(rules[0].allowedRoleIds).toEqual([]);
  });

  it('filters non-numeric values from JSON arrays', async () => {
    const host = await insertHost();
    const now = nowIso();
    await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id, pathPattern: '/test',
      allowedRoleIds: '[1, "hello", null, 3]', allowedCertIds: '[]',
      createdAt: now, updatedAt: now,
    });

    const rules = await listMtlsAccessRules(host.id);
    expect(rules[0].allowedRoleIds).toEqual([1, 3]);
  });

  it('handles non-array JSON', async () => {
    const host = await insertHost();
    const now = nowIso();
    await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id, pathPattern: '/test',
      allowedRoleIds: '{"foo": 1}', allowedCertIds: '"string"',
      createdAt: now, updatedAt: now,
    });

    const rules = await listMtlsAccessRules(host.id);
    expect(rules[0].allowedRoleIds).toEqual([]);
    expect(rules[0].allowedCertIds).toEqual([]);
  });
});
