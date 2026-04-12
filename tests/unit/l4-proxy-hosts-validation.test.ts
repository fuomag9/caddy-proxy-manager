/**
 * Unit tests for L4 proxy host input validation.
 *
 * Tests the validation logic in the L4 proxy hosts model
 * without requiring a database connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestDb } from '../helpers/db';

// Mock db so the model module can be imported
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
  createL4ProxyHost,
  type L4ProxyHostInput,
} from '../../src/lib/models/l4-proxy-hosts';
import * as schema from '../../src/lib/db/schema';

// ---------------------------------------------------------------------------
// Setup: insert a test user so the FK constraint on ownerUserId is satisfied
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await ctx.db.delete(schema.l4ProxyHosts);
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

// ---------------------------------------------------------------------------
// Validation tests via createL4ProxyHost (which calls validateL4Input)
// ---------------------------------------------------------------------------

describe('L4 proxy host create validation', () => {
  it('rejects empty name', async () => {
    const input: L4ProxyHostInput = {
      name: '',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Name is required');
  });

  it('rejects invalid protocol', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'sctp' as any,
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("Protocol must be 'tcp' or 'udp'");
  });

  it('rejects empty listen address', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: '',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Listen address is required');
  });

  it('rejects listen address without port', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: '10.0.0.1',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("Listen address must be in format ':PORT' or 'HOST:PORT'");
  });

  it('rejects listen address with port 0', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':0',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Port must be between 1 and 65535');
  });

  it('rejects listen address with port > 65535', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':99999',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Port must be between 1 and 65535');
  });

  it('rejects empty upstreams', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: [],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('At least one upstream must be specified');
  });

  it('rejects upstream without port', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("must be in 'host:port' format");
  });

  it('rejects TLS termination with UDP', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'udp',
      listenAddress: ':5353',
      upstreams: ['8.8.8.8:53'],
      tlsTermination: true,
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('TLS termination is only supported with TCP');
  });

  it('rejects TLS SNI matcher without values', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432'],
      matcherType: 'tls_sni',
      matcherValue: [],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Matcher value is required');
  });

  it('rejects HTTP host matcher without values', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':8080',
      upstreams: ['10.0.0.1:8080'],
      matcherType: 'http_host',
      matcherValue: [],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Matcher value is required');
  });

  it('rejects invalid proxy protocol version', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432'],
      proxyProtocolVersion: 'v3' as any,
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("Proxy protocol version must be 'v1' or 'v2'");
  });

  it('rejects invalid matcher type', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432'],
      matcherType: 'invalid' as any,
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Matcher type must be one of');
  });

  it('accepts valid TCP proxy with all options', async () => {
    const input: L4ProxyHostInput = {
      name: 'Full Featured',
      protocol: 'tcp',
      listenAddress: ':993',
      upstreams: ['localhost:143'],
      matcherType: 'tls_sni',
      matcherValue: ['mail.example.com'],
      tlsTermination: true,
      proxyProtocolVersion: 'v1',
      proxyProtocolReceive: true,
      enabled: true,
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result).toBeDefined();
    expect(result.name).toBe('Full Featured');
    expect(result.protocol).toBe('tcp');
    expect(result.listenAddress).toBe(':993');
    expect(result.upstreams).toEqual(['localhost:143']);
    expect(result.matcherType).toBe('tls_sni');
    expect(result.matcherValue).toEqual(['mail.example.com']);
    expect(result.tlsTermination).toBe(true);
    expect(result.proxyProtocolVersion).toBe('v1');
    expect(result.proxyProtocolReceive).toBe(true);
  });

  it('accepts valid UDP proxy', async () => {
    const input: L4ProxyHostInput = {
      name: 'DNS',
      protocol: 'udp',
      listenAddress: ':5353',
      upstreams: ['8.8.8.8:53'],
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result).toBeDefined();
    expect(result.protocol).toBe('udp');
  });

  it('accepts host:port format for listen address', async () => {
    const input: L4ProxyHostInput = {
      name: 'Bound',
      protocol: 'tcp',
      listenAddress: '0.0.0.0:5432',
      upstreams: ['10.0.0.1:5432'],
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.listenAddress).toBe('0.0.0.0:5432');
  });

  it('accepts none matcher without matcherValue', async () => {
    const input: L4ProxyHostInput = {
      name: 'Catch All',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432'],
      matcherType: 'none',
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.matcherType).toBe('none');
  });

  it('accepts proxy_protocol matcher without matcherValue', async () => {
    const input: L4ProxyHostInput = {
      name: 'PP Detect',
      protocol: 'tcp',
      listenAddress: ':8443',
      upstreams: ['10.0.0.1:443'],
      matcherType: 'proxy_protocol',
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.matcherType).toBe('proxy_protocol');
  });

  it('trims whitespace from name and listenAddress', async () => {
    const input: L4ProxyHostInput = {
      name: '  Spacey Name  ',
      protocol: 'tcp',
      listenAddress: '  :5432  ',
      upstreams: ['10.0.0.1:5432'],
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.name).toBe('Spacey Name');
    expect(result.listenAddress).toBe(':5432');
  });

  it('deduplicates upstreams', async () => {
    const input: L4ProxyHostInput = {
      name: 'Dedup',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432', '10.0.0.1:5432', '10.0.0.2:5432'],
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.upstreams).toEqual(['10.0.0.1:5432', '10.0.0.2:5432']);
  });
});
