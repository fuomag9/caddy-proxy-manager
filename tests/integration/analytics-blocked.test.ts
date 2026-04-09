import { describe, it, expect, vi } from 'vitest';

// Mock dependencies so we can import collectBlockedSignatures and parseLine.
vi.mock('@/src/lib/db', () => ({
  default: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
    run: vi.fn(),
  },
}));
vi.mock('maxmind', () => ({ default: { open: vi.fn().mockResolvedValue(null) } }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
  createReadStream: vi.fn(),
}));
vi.mock('@/src/lib/clickhouse/client', () => ({
  insertTrafficEvents: vi.fn().mockResolvedValue(undefined),
}));

import { collectBlockedSignatures, parseLine } from '@/src/lib/log-parser';

const NOW = Math.floor(Date.now() / 1000);

describe('log-parser blocked detection', () => {
  describe('collectBlockedSignatures', () => {
    it('collects signatures from caddy-blocker "request blocked" entries', () => {
      const lines = [
        JSON.stringify({ ts: NOW + 0.01, msg: 'request blocked', plugin: 'caddy-blocker', client_ip: '1.2.3.4', method: 'GET', uri: '/secret' }),
        JSON.stringify({ ts: NOW + 0.5, msg: 'handled request', status: 200, request: { client_ip: '5.6.7.8' } }),
      ];
      const set = collectBlockedSignatures(lines);
      expect(set.size).toBe(1);
    });

    it('returns empty set when no blocked entries', () => {
      const lines = [
        JSON.stringify({ ts: NOW, msg: 'handled request', status: 200, request: { client_ip: '1.2.3.4' } }),
      ];
      expect(collectBlockedSignatures(lines).size).toBe(0);
    });

    it('ignores non-caddy-blocker entries', () => {
      const lines = [
        JSON.stringify({ ts: NOW, msg: 'request blocked', plugin: 'other-plugin', client_ip: '1.2.3.4', method: 'GET', uri: '/' }),
      ];
      expect(collectBlockedSignatures(lines).size).toBe(0);
    });
  });

  describe('parseLine', () => {
    it('marks blocked request as is_blocked=true', () => {
      const blockedLogLine = JSON.stringify({
        ts: NOW + 0.01, msg: 'request blocked', plugin: 'caddy-blocker',
        client_ip: '203.0.113.5', method: 'GET', uri: '/secret',
      });
      const handledLine = JSON.stringify({
        ts: NOW + 0.99, msg: 'handled request', status: 403, size: 9,
        request: { client_ip: '203.0.113.5', host: 'example.com', method: 'GET', uri: '/secret', proto: 'HTTP/2.0' },
      });

      const blockedSet = collectBlockedSignatures([blockedLogLine, handledLine]);
      const row = parseLine(handledLine, blockedSet);
      expect(row).not.toBeNull();
      expect(row!.is_blocked).toBe(true);
      expect(row!.client_ip).toBe('203.0.113.5');
      expect(row!.host).toBe('example.com');
    });

    it('marks normal request as is_blocked=false', () => {
      const line = JSON.stringify({
        ts: NOW, msg: 'handled request', status: 200, size: 1024,
        request: { client_ip: '1.2.3.4', host: 'example.com', method: 'GET', uri: '/', proto: 'HTTP/2.0' },
      });
      const row = parseLine(line, new Set());
      expect(row).not.toBeNull();
      expect(row!.is_blocked).toBe(false);
    });

    it('skips non-handled-request entries', () => {
      const line = JSON.stringify({ ts: NOW, msg: 'request blocked', plugin: 'caddy-blocker' });
      expect(parseLine(line, new Set())).toBeNull();
    });

    it('extracts user agent from headers', () => {
      const line = JSON.stringify({
        ts: NOW, msg: 'handled request', status: 200, size: 0,
        request: { client_ip: '1.2.3.4', host: 'example.com', method: 'GET', uri: '/', proto: 'HTTP/1.1', headers: { 'User-Agent': ['TestBot/1.0'] } },
      });
      const row = parseLine(line, new Set());
      expect(row!.user_agent).toBe('TestBot/1.0');
    });
  });
});
