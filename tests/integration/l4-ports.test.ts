/**
 * Integration tests for L4 port management.
 *
 * Tests the port computation, override file generation, diff detection,
 * and status lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestDb } from '../helpers/db';

// ---------------------------------------------------------------------------
// Mock db and set L4_PORTS_DIR to a temp directory for file operations
// ---------------------------------------------------------------------------

const ctx = vi.hoisted(() => {
  const { mkdirSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const dir = join(tmpdir(), `l4-ports-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  process.env.L4_PORTS_DIR = dir;
  return { db: null as unknown as TestDb, tmpDir: dir };
});

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

import * as schema from '../../src/lib/db/schema';
import {
  getRequiredL4Ports,
  getAppliedL4Ports,
  getL4PortsDiff,
  applyL4Ports,
  getL4PortsStatus,
} from '../../src/lib/l4-ports';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function makeL4Host(overrides: Partial<typeof schema.l4ProxyHosts.$inferInsert> = {}) {
  const now = nowIso();
  return {
    name: 'Test L4 Host',
    protocol: 'tcp',
    listenAddress: ':5432',
    upstreams: JSON.stringify(['10.0.0.1:5432']),
    matcherType: 'none',
    matcherValue: null,
    tlsTermination: false,
    proxyProtocolVersion: null,
    proxyProtocolReceive: false,
    ownerUserId: null,
    meta: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies typeof schema.l4ProxyHosts.$inferInsert;
}

function cleanTmpDir() {
  for (const file of ['docker-compose.l4-ports.yml', 'l4-ports.trigger', 'l4-ports.status']) {
    const path = join(ctx.tmpDir, file);
    if (existsSync(path)) rmSync(path);
  }
}

beforeEach(async () => {
  await ctx.db.delete(schema.l4ProxyHosts);
  cleanTmpDir();
});

// ---------------------------------------------------------------------------
// getRequiredL4Ports
// ---------------------------------------------------------------------------

describe('getRequiredL4Ports', () => {
  it('returns empty array when no L4 hosts exist', async () => {
    const ports = await getRequiredL4Ports();
    expect(ports).toEqual([]);
  });

  it('returns TCP port for enabled host', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5432',
      protocol: 'tcp',
      enabled: true,
    }));
    const ports = await getRequiredL4Ports();
    expect(ports).toEqual(['5432:5432']);
  });

  it('returns UDP port with /udp suffix', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5353',
      protocol: 'udp',
      enabled: true,
    }));
    const ports = await getRequiredL4Ports();
    expect(ports).toEqual(['5353:5353/udp']);
  });

  it('excludes disabled hosts', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'Enabled',
      listenAddress: ':5432',
      enabled: true,
    }));
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'Disabled',
      listenAddress: ':3306',
      enabled: false,
    }));
    const ports = await getRequiredL4Ports();
    expect(ports).toEqual(['5432:5432']);
  });

  it('deduplicates ports from multiple hosts on same address', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'Host 1',
      listenAddress: ':5432',
    }));
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'Host 2',
      listenAddress: ':5432',
    }));
    const ports = await getRequiredL4Ports();
    expect(ports).toEqual(['5432:5432']);
  });

  it('handles HOST:PORT format', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: '0.0.0.0:5432',
    }));
    const ports = await getRequiredL4Ports();
    expect(ports).toEqual(['5432:5432']);
  });

  it('returns multiple ports sorted', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'Redis',
      listenAddress: ':6379',
    }));
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'PG',
      listenAddress: ':5432',
    }));
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'MySQL',
      listenAddress: ':3306',
    }));
    const ports = await getRequiredL4Ports();
    expect(ports).toEqual(['3306:3306', '5432:5432', '6379:6379']);
  });
});

// ---------------------------------------------------------------------------
// getAppliedL4Ports
// ---------------------------------------------------------------------------

describe('getAppliedL4Ports', () => {
  it('returns empty when no override file exists', () => {
    const ports = getAppliedL4Ports();
    expect(ports).toEqual([]);
  });

  it('parses ports from override file', () => {
    writeFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), `services:
  caddy:
    ports:
      - "5432:5432"
      - "3306:3306"
`);
    const ports = getAppliedL4Ports();
    expect(ports).toEqual(['3306:3306', '5432:5432']);
  });

  it('handles empty override file', () => {
    writeFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), `services: {}
`);
    const ports = getAppliedL4Ports();
    expect(ports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getL4PortsDiff
// ---------------------------------------------------------------------------

describe('getL4PortsDiff', () => {
  it('needsApply is false when no hosts and no override', async () => {
    const diff = await getL4PortsDiff();
    expect(diff.needsApply).toBe(false);
    expect(diff.requiredPorts).toEqual([]);
    expect(diff.currentPorts).toEqual([]);
  });

  it('needsApply is true when host exists but no override', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5432',
    }));
    const diff = await getL4PortsDiff();
    expect(diff.needsApply).toBe(true);
    expect(diff.requiredPorts).toEqual(['5432:5432']);
    expect(diff.currentPorts).toEqual([]);
  });

  it('needsApply is false when override matches', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5432',
    }));
    writeFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), `services:
  caddy:
    ports:
      - "5432:5432"
`);
    const diff = await getL4PortsDiff();
    expect(diff.needsApply).toBe(false);
  });

  it('needsApply is true when override has different ports', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5432',
    }));
    writeFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), `services:
  caddy:
    ports:
      - "3306:3306"
`);
    const diff = await getL4PortsDiff();
    expect(diff.needsApply).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyL4Ports
// ---------------------------------------------------------------------------

describe('applyL4Ports', () => {
  it('writes override file with required ports', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5432',
    }));
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      name: 'DNS',
      listenAddress: ':5353',
      protocol: 'udp',
    }));

    const status = await applyL4Ports();
    expect(status.state).toBe('pending');

    const overrideContent = readFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), 'utf-8');
    expect(overrideContent).toContain('"5432:5432"');
    expect(overrideContent).toContain('"5353:5353/udp"');
  });

  it('writes trigger file', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5432',
    }));

    await applyL4Ports();
    const triggerPath = join(ctx.tmpDir, 'l4-ports.trigger');
    expect(existsSync(triggerPath)).toBe(true);

    const trigger = JSON.parse(readFileSync(triggerPath, 'utf-8'));
    expect(trigger.triggeredAt).toBeDefined();
    expect(trigger.ports).toEqual(['5432:5432']);
  });

  it('writes empty override when no ports needed', async () => {
    const status = await applyL4Ports();
    expect(status.state).toBe('pending');

    const overrideContent = readFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), 'utf-8');
    expect(overrideContent).toContain('services: {}');
  });

  it('override file is idempotent — same ports produce same content', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({
      listenAddress: ':5432',
    }));

    await applyL4Ports();
    const content1 = readFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), 'utf-8');

    await applyL4Ports();
    const content2 = readFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), 'utf-8');

    expect(content1).toBe(content2);
  });
});

// ---------------------------------------------------------------------------
// getL4PortsStatus
// ---------------------------------------------------------------------------

describe('getL4PortsStatus', () => {
  it('returns idle when no status file exists', () => {
    const status = getL4PortsStatus();
    expect(status.state).toBe('idle');
  });

  it('returns idle when no status file exists even if trigger file is present', () => {
    // Trigger files are deleted by the sidecar after processing.
    // A leftover trigger file must NEVER cause "Waiting for port manager sidecar..."
    // because that message gets permanently stuck if the sidecar is slow or restarting.
    writeFileSync(join(ctx.tmpDir, 'l4-ports.trigger'), JSON.stringify({
      triggeredAt: new Date().toISOString(),
    }));
    const status = getL4PortsStatus();
    expect(status.state).toBe('idle');
  });

  it('returns applied when status file says applied', () => {
    writeFileSync(join(ctx.tmpDir, 'l4-ports.status'), JSON.stringify({
      state: 'applied',
      message: 'Success',
      appliedAt: new Date().toISOString(),
    }));
    const status = getL4PortsStatus();
    expect(status.state).toBe('applied');
  });

  it('returns failed when status file says failed', () => {
    writeFileSync(join(ctx.tmpDir, 'l4-ports.status'), JSON.stringify({
      state: 'failed',
      message: 'Failed',
      error: 'Container failed',
      appliedAt: new Date().toISOString(),
    }));
    const status = getL4PortsStatus();
    expect(status.state).toBe('failed');
    expect(status.error).toBe('Container failed');
  });

  it('returns status from file regardless of trigger file presence', () => {
    // The sidecar deletes triggers after processing, so the status file is
    // the single source of truth — trigger file presence is irrelevant here.
    writeFileSync(join(ctx.tmpDir, 'l4-ports.trigger'), JSON.stringify({
      triggeredAt: '2026-03-21T12:00:00Z',
    }));
    writeFileSync(join(ctx.tmpDir, 'l4-ports.status'), JSON.stringify({
      state: 'applied',
      message: 'Done',
      appliedAt: '2026-01-01T00:00:00Z',
    }));
    const status = getL4PortsStatus();
    expect(status.state).toBe('applied');
  });
});
