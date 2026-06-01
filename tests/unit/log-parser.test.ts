import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies before importing the module under test
vi.mock('@/src/lib/db', () => ({
  default: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
    run: vi.fn(),
  },
  nowIso: () => new Date().toISOString(),
  toIso: (v: string | Date | null | undefined) => v ? new Date(v as string).toISOString() : null,
}));

vi.mock('maxmind', () => ({
  default: {
    open: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
  createReadStream: vi.fn(),
}));

vi.mock('@/src/lib/clickhouse/client', () => ({
  insertTrafficEvents: vi.fn().mockResolvedValue(undefined),
}));

import { parseLine, collectBlockedSignatures, pruneBlockedSignatures } from '@/src/lib/log-parser';

describe('log-parser', () => {
  describe('collectBlockedSignatures', () => {
    it('returns empty set for empty lines array', () => {
      const result = collectBlockedSignatures([]);
      expect(result.size).toBe(0);
    });

    it('picks up caddy-blocker "request blocked" entries', () => {
      const entry = JSON.stringify({
        ts: 1700000000.123,
        msg: 'request blocked',
        plugin: 'caddy-blocker',
        client_ip: '1.2.3.4',
        method: 'GET',
        uri: '/evil',
      });
      const result = collectBlockedSignatures([entry]);
      expect(result.size).toBe(1);
      // key format: ${ts}|${clientIp}|${method}|${uri}
      const key = `1700000000|1.2.3.4|GET|/evil`;
      expect(result.has(key)).toBe(true);
    });

    it('ignores entries without msg "request blocked"', () => {
      const entry = JSON.stringify({
        ts: 1700000000,
        msg: 'handled request',
        plugin: 'caddy-blocker',
        client_ip: '1.2.3.4',
        method: 'GET',
        uri: '/normal',
      });
      const result = collectBlockedSignatures([entry]);
      expect(result.size).toBe(0);
    });

    it('ignores entries without plugin "caddy-blocker"', () => {
      const entry = JSON.stringify({
        ts: 1700000000,
        msg: 'request blocked',
        plugin: 'other-plugin',
        client_ip: '1.2.3.4',
        method: 'GET',
        uri: '/path',
      });
      const result = collectBlockedSignatures([entry]);
      expect(result.size).toBe(0);
    });

    it('ignores malformed JSON lines', () => {
      const result = collectBlockedSignatures(['{not valid json}', '']);
      expect(result.size).toBe(0);
    });

    it('collects multiple blocked signatures', () => {
      const lines = [
        JSON.stringify({ ts: 1700000001, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '1.2.3.4', method: 'POST', uri: '/a' }),
        JSON.stringify({ ts: 1700000002, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '5.6.7.8', method: 'GET', uri: '/b' }),
      ];
      const result = collectBlockedSignatures(lines);
      expect(result.size).toBe(2);
    });
  });

  describe('parseLine', () => {
    const emptyBlocked = new Set<string>();

    it('parses a valid "handled request" entry into a traffic event row', () => {
      const entry = JSON.stringify({
        ts: 1700000100.5,
        msg: 'handled request',
        status: 200,
        size: 1234,
        request: {
          client_ip: '10.0.0.1',
          host: 'example.com',
          method: 'GET',
          uri: '/path',
          proto: 'HTTP/1.1',
          headers: { 'User-Agent': ['Mozilla/5.0'] },
        },
      });

      const result = parseLine(entry, emptyBlocked);
      expect(result).not.toBeNull();
      expect(result!.ts).toBe(1700000100);
      expect(result!.client_ip).toBe('10.0.0.1');
      expect(result!.host).toBe('example.com');
      expect(result!.method).toBe('GET');
      expect(result!.uri).toBe('/path');
      expect(result!.status).toBe(200);
      expect(result!.proto).toBe('HTTP/1.1');
      expect(result!.bytes_sent).toBe(1234);
      expect(result!.user_agent).toBe('Mozilla/5.0');
      expect(result!.is_blocked).toBe(false);
    });

    it('returns null for entries with wrong msg field', () => {
      const entry = JSON.stringify({ ts: 1700000100, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '1.2.3.4', method: 'GET', uri: '/' });
      expect(parseLine(entry, emptyBlocked)).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parseLine('{bad json', emptyBlocked)).toBeNull();
    });

    it('uses fallback empty strings for missing request fields', () => {
      const entry = JSON.stringify({ ts: 1700000100, msg: 'handled request', status: 200 });
      const result = parseLine(entry, emptyBlocked);
      expect(result).not.toBeNull();
      expect(result!.client_ip).toBe('');
      expect(result!.host).toBe('');
      expect(result!.method).toBe('');
      expect(result!.uri).toBe('');
      expect(result!.user_agent).toBe('');
    });

    it('marks isBlocked true when signature matches blocked set', () => {
      const ts = 1700000200;
      const entry = JSON.stringify({
        ts,
        msg: 'handled request',
        status: 403,
        request: { client_ip: '1.2.3.4', method: 'GET', uri: '/evil', host: 'x.com' },
      });
      const blocked = new Set([`${ts}|1.2.3.4|GET|/evil`]);
      const result = parseLine(entry, blocked);
      expect(result!.is_blocked).toBe(true);
    });

    it('consumes collected blocked signatures once to avoid over-marking duplicates', () => {
      const ts = 1700000200;
      const blocked = collectBlockedSignatures([
        JSON.stringify({ ts, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '1.2.3.4', method: 'GET', uri: '/repeat' }),
      ]);
      const entry = JSON.stringify({
        ts,
        msg: 'handled request',
        status: 200,
        request: { client_ip: '1.2.3.4', method: 'GET', uri: '/repeat', host: 'x.com' },
      });

      expect(parseLine(entry, blocked)!.is_blocked).toBe(true);
      expect(parseLine(entry, blocked)!.is_blocked).toBe(false);
    });

    it('uses remote_ip as fallback when client_ip is missing', () => {
      const entry = JSON.stringify({
        ts: 1700000300,
        msg: 'handled request',
        status: 200,
        request: { remote_ip: '9.8.7.6', host: 'test.com', method: 'GET', uri: '/' },
      });
      const result = parseLine(entry, emptyBlocked);
      expect(result!.client_ip).toBe('9.8.7.6');
    });

    it('countryCode is null when GeoIP reader is not initialized', () => {
      const entry = JSON.stringify({
        ts: 1700000400,
        msg: 'handled request',
        status: 200,
        request: { client_ip: '8.8.8.8', host: 'test.com', method: 'GET', uri: '/' },
      });
      const result = parseLine(entry, emptyBlocked);
      expect(result!.country_code).toBeNull();
    });
  });

  describe('cross-pass blocked signature carry-over', () => {
    it('merges new signatures onto an existing (carried-over) map', () => {
      const ts = 1700000500;
      const pending = collectBlockedSignatures([
        JSON.stringify({ ts, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '1.1.1.1', method: 'GET', uri: '/a' }),
      ]);
      // Second pass merges a new signature into the carried-over map.
      const merged = collectBlockedSignatures([
        JSON.stringify({ ts, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '2.2.2.2', method: 'GET', uri: '/b' }),
      ], pending);
      expect(merged).toBe(pending);
      expect(merged.size).toBe(2);
      expect(merged.get(`${ts}|1.1.1.1|GET|/a`)).toBe(1);
      expect(merged.get(`${ts}|2.2.2.2|GET|/b`)).toBe(1);
    });

    it('marks a handled request whose block signature arrived in a previous pass', () => {
      const ts = 1700000600;
      // Pass 1: only the "request blocked" line is present (the tick boundary
      // fell before the "handled request" row was written).
      const carried = collectBlockedSignatures([
        JSON.stringify({ ts, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '3.3.3.3', method: 'GET', uri: '/x' }),
      ]);
      const handled = JSON.stringify({
        ts, msg: 'handled request', status: 403,
        request: { client_ip: '3.3.3.3', method: 'GET', uri: '/x', host: 'x.com' },
      });
      // Pass 2: the handled request consumes the carried-over signature.
      const pass2 = collectBlockedSignatures([], carried);
      expect(parseLine(handled, pass2)!.is_blocked).toBe(true);
    });
  });

  describe('pruneBlockedSignatures', () => {
    it('drops signatures older than the carry-over window, keeps recent ones', () => {
      const now = 1700001000;
      const blocked = new Map<string, number>([
        [`${now - 10}|1.1.1.1|GET|/recent`, 1],   // within 120s window
        [`${now - 500}|2.2.2.2|GET|/stale`, 1],    // older than window
      ]);
      pruneBlockedSignatures(blocked, now);
      expect(blocked.has(`${now - 10}|1.1.1.1|GET|/recent`)).toBe(true);
      expect(blocked.has(`${now - 500}|2.2.2.2|GET|/stale`)).toBe(false);
    });

    it('drops fully-consumed (count <= 0) entries', () => {
      const now = 1700001000;
      const blocked = new Map<string, number>([[`${now}|1.1.1.1|GET|/done`, 0]]);
      pruneBlockedSignatures(blocked, now);
      expect(blocked.size).toBe(0);
    });
  });
});
