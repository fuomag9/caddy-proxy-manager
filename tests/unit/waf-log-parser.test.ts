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

import { extractBracketField } from '@/src/lib/waf-log-parser';

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
