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

import { parseLine, collectBlockedSignatures } from '@/src/lib/log-parser';

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
      expect(result!.clientIp).toBe('10.0.0.1');
      expect(result!.host).toBe('example.com');
      expect(result!.method).toBe('GET');
      expect(result!.uri).toBe('/path');
      expect(result!.status).toBe(200);
      expect(result!.proto).toBe('HTTP/1.1');
      expect(result!.bytesSent).toBe(1234);
      expect(result!.userAgent).toBe('Mozilla/5.0');
      expect(result!.isBlocked).toBe(false);
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
      expect(result!.clientIp).toBe('');
      expect(result!.host).toBe('');
      expect(result!.method).toBe('');
      expect(result!.uri).toBe('');
      expect(result!.userAgent).toBe('');
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
      expect(result!.isBlocked).toBe(true);
    });

    it('uses remote_ip as fallback when client_ip is missing', () => {
      const entry = JSON.stringify({
        ts: 1700000300,
        msg: 'handled request',
        status: 200,
        request: { remote_ip: '9.8.7.6', host: 'test.com', method: 'GET', uri: '/' },
      });
      const result = parseLine(entry, emptyBlocked);
      expect(result!.clientIp).toBe('9.8.7.6');
    });

    it('countryCode is null when GeoIP reader is not initialized', () => {
      const entry = JSON.stringify({
        ts: 1700000400,
        msg: 'handled request',
        status: 200,
        request: { client_ip: '8.8.8.8', host: 'test.com', method: 'GET', uri: '/' },
      });
      const result = parseLine(entry, emptyBlocked);
      expect(result!.countryCode).toBeNull();
    });

    it('marks isBlocked true for geo-blocked requests (status 403, Server:Caddy, no Via)', () => {
      const entry = JSON.stringify({
        ts: 1700000500,
        msg: 'handled request',
        status: 403,
        request: { client_ip: '1.2.3.4', host: 'example.com', method: 'GET', uri: '/' },
        resp_headers: { Server: ['Caddy'] },
      });
      const result = parseLine(entry, emptyBlocked);
      expect(result!.isBlocked).toBe(true);
    });

    it('does not mark isBlocked for upstream 403 responses (Via header present)', () => {
      const entry = JSON.stringify({
        ts: 1700000600,
        msg: 'handled request',
        status: 403,
        request: { client_ip: '1.2.3.4', host: 'example.com', method: 'GET', uri: '/private' },
        resp_headers: { Server: ['Caddy'], Via: ['1.1 upstream'] },
      });
      const result = parseLine(entry, emptyBlocked);
      expect(result!.isBlocked).toBe(false);
    });

    it('does not mark isBlocked for non-403 Caddy responses', () => {
      const entry = JSON.stringify({
        ts: 1700000700,
        msg: 'handled request',
        status: 200,
        request: { client_ip: '1.2.3.4', host: 'example.com', method: 'GET', uri: '/' },
        resp_headers: { Server: ['Caddy'] },
      });
      const result = parseLine(entry, emptyBlocked);
      expect(result!.isBlocked).toBe(false);
    });
  });
});
