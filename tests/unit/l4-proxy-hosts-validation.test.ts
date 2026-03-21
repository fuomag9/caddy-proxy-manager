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
  updateL4ProxyHost,
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
      listen_address: ':5432',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Name is required');
  });

  it('rejects invalid protocol', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'sctp' as any,
      listen_address: ':5432',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("Protocol must be 'tcp' or 'udp'");
  });

  it('rejects empty listen address', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: '',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Listen address is required');
  });

  it('rejects listen address without port', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: '10.0.0.1',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("Listen address must be in format ':PORT' or 'HOST:PORT'");
  });

  it('rejects listen address with port 0', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':0',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Port must be between 1 and 65535');
  });

  it('rejects listen address with port > 65535', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':99999',
      upstreams: ['10.0.0.1:5432'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Port must be between 1 and 65535');
  });

  it('rejects empty upstreams', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':5432',
      upstreams: [],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('At least one upstream must be specified');
  });

  it('rejects upstream without port', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':5432',
      upstreams: ['10.0.0.1'],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("must be in 'host:port' format");
  });

  it('rejects TLS termination with UDP', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'udp',
      listen_address: ':5353',
      upstreams: ['8.8.8.8:53'],
      tls_termination: true,
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('TLS termination is only supported with TCP');
  });

  it('rejects TLS SNI matcher without values', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':5432',
      upstreams: ['10.0.0.1:5432'],
      matcher_type: 'tls_sni',
      matcher_value: [],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Matcher value is required');
  });

  it('rejects HTTP host matcher without values', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':8080',
      upstreams: ['10.0.0.1:8080'],
      matcher_type: 'http_host',
      matcher_value: [],
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Matcher value is required');
  });

  it('rejects invalid proxy protocol version', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':5432',
      upstreams: ['10.0.0.1:5432'],
      proxy_protocol_version: 'v3' as any,
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow("Proxy protocol version must be 'v1' or 'v2'");
  });

  it('rejects invalid matcher type', async () => {
    const input: L4ProxyHostInput = {
      name: 'Test',
      protocol: 'tcp',
      listen_address: ':5432',
      upstreams: ['10.0.0.1:5432'],
      matcher_type: 'invalid' as any,
    };
    await expect(createL4ProxyHost(input, 1)).rejects.toThrow('Matcher type must be one of');
  });

  it('accepts valid TCP proxy with all options', async () => {
    const input: L4ProxyHostInput = {
      name: 'Full Featured',
      protocol: 'tcp',
      listen_address: ':993',
      upstreams: ['localhost:143'],
      matcher_type: 'tls_sni',
      matcher_value: ['mail.example.com'],
      tls_termination: true,
      proxy_protocol_version: 'v1',
      proxy_protocol_receive: true,
      enabled: true,
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result).toBeDefined();
    expect(result.name).toBe('Full Featured');
    expect(result.protocol).toBe('tcp');
    expect(result.listen_address).toBe(':993');
    expect(result.upstreams).toEqual(['localhost:143']);
    expect(result.matcher_type).toBe('tls_sni');
    expect(result.matcher_value).toEqual(['mail.example.com']);
    expect(result.tls_termination).toBe(true);
    expect(result.proxy_protocol_version).toBe('v1');
    expect(result.proxy_protocol_receive).toBe(true);
  });

  it('accepts valid UDP proxy', async () => {
    const input: L4ProxyHostInput = {
      name: 'DNS',
      protocol: 'udp',
      listen_address: ':5353',
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
      listen_address: '0.0.0.0:5432',
      upstreams: ['10.0.0.1:5432'],
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.listen_address).toBe('0.0.0.0:5432');
  });

  it('accepts none matcher without matcher_value', async () => {
    const input: L4ProxyHostInput = {
      name: 'Catch All',
      protocol: 'tcp',
      listen_address: ':5432',
      upstreams: ['10.0.0.1:5432'],
      matcher_type: 'none',
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.matcher_type).toBe('none');
  });

  it('accepts proxy_protocol matcher without matcher_value', async () => {
    const input: L4ProxyHostInput = {
      name: 'PP Detect',
      protocol: 'tcp',
      listen_address: ':8443',
      upstreams: ['10.0.0.1:443'],
      matcher_type: 'proxy_protocol',
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.matcher_type).toBe('proxy_protocol');
  });

  it('trims whitespace from name and listen_address', async () => {
    const input: L4ProxyHostInput = {
      name: '  Spacey Name  ',
      protocol: 'tcp',
      listen_address: '  :5432  ',
      upstreams: ['10.0.0.1:5432'],
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.name).toBe('Spacey Name');
    expect(result.listen_address).toBe(':5432');
  });

  it('deduplicates upstreams', async () => {
    const input: L4ProxyHostInput = {
      name: 'Dedup',
      protocol: 'tcp',
      listen_address: ':5432',
      upstreams: ['10.0.0.1:5432', '10.0.0.1:5432', '10.0.0.2:5432'],
    };
    const result = await createL4ProxyHost(input, 1);
    expect(result.upstreams).toEqual(['10.0.0.1:5432', '10.0.0.2:5432']);
  });
});
