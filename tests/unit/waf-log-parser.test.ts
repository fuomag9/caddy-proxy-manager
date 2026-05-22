import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies before importing
vi.mock('@/src/lib/db', () => ({
  default: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
    run: vi.fn(),
  },
  nowIso: () => new Date().toISOString(),
}));

vi.mock('maxmind', () => ({
  default: { open: vi.fn().mockResolvedValue(null) },
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
  createReadStream: vi.fn(),
}));

import { extractBracketField, parseLine } from '@/src/lib/waf-log-parser';

describe('extractBracketField', () => {
  it('extracts id from [id "941100"]', () => {
    expect(extractBracketField('[id "941100"]', 'id')).toBe('941100');
  });

  it('extracts msg from [msg "XSS Attack Detected"]', () => {
    expect(extractBracketField('[msg "XSS Attack Detected"]', 'msg')).toBe('XSS Attack Detected');
  });

  it('extracts severity from [severity "critical"]', () => {
    expect(extractBracketField('[severity "critical"]', 'severity')).toBe('critical');
  });

  it('extracts unique_id from [unique_id "abc123"]', () => {
    expect(extractBracketField('[unique_id "abc123"]', 'unique_id')).toBe('abc123');
  });

  it('returns null for field not present', () => {
    expect(extractBracketField('[msg "something"]', 'id')).toBeNull();
  });

  it('works when multiple fields are present in one string', () => {
    const msg = '[id "941100"] [msg "XSS Attack"] [severity "critical"] [unique_id "abc123"]';
    expect(extractBracketField(msg, 'id')).toBe('941100');
    expect(extractBracketField(msg, 'msg')).toBe('XSS Attack');
    expect(extractBracketField(msg, 'severity')).toBe('critical');
    expect(extractBracketField(msg, 'unique_id')).toBe('abc123');
  });

  it('handles special characters in field values', () => {
    const msg = '[msg "SQL Injection: SELECT * FROM users WHERE id=1"]';
    expect(extractBracketField(msg, 'msg')).toBe('SQL Injection: SELECT * FROM users WHERE id=1');
  });

  it('returns null for empty string input', () => {
    expect(extractBracketField('', 'id')).toBeNull();
  });
});

describe('parseLine host header contract', () => {
  const ruleMap = new Map([
    ['tx-1', { ruleId: 941100, ruleMessage: 'XSS', severity: 'critical' }],
  ]);

  function makeAuditLine(hostHeader: string): string {
    return JSON.stringify({
      transaction: {
        id: 'tx-1',
        client_ip: '1.2.3.4',
        unix_timestamp: 1_700_000_000_000_000_000,
        is_interrupted: true,
        request: {
          method: 'GET',
          uri: '/',
          headers: { host: [hostHeader] },
        },
      },
    });
  }

  it('stores host header verbatim — bare hostname has no port', () => {
    const row = parseLine(makeAuditLine('example.com'), ruleMap);
    expect(row?.host).toBe('example.com');
  });

  it('stores host header verbatim — port suffix is preserved (downstream must strip)', () => {
    // Some HTTPS clients (e.g. HTTP/2 :authority, explicit "Host: foo:443" header)
    // include the port. Suppression code in settings/actions.ts must normalize.
    const row = parseLine(makeAuditLine('app.example.com:443'), ruleMap);
    expect(row?.host).toBe('app.example.com:443');
  });

  it('handles missing host header without throwing', () => {
    const line = JSON.stringify({
      transaction: {
        id: 'tx-1',
        client_ip: '1.2.3.4',
        unix_timestamp: 1_700_000_000_000_000_000,
        is_interrupted: true,
        request: { method: 'GET', uri: '/', headers: {} },
      },
    });
    const row = parseLine(line, ruleMap);
    expect(row?.host).toBe('');
  });
});
