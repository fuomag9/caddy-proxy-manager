/**
 * Unit tests for src/lib/form-parse.ts
 * Tests all pure FormData parsing helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  parseUpstreams,
  parseCheckbox,
  parseOptionalText,
  parseCertificateId,
  parseAccessListId,
  parseOptionalNumber,
} from '@/src/lib/form-parse';

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('splits by comma', () => {
    expect(parseCsv('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('splits by newline (newlines converted to commas)', () => {
    expect(parseCsv('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace from each item', () => {
    expect(parseCsv('  a  ,  b  ')).toEqual(['a', 'b']);
  });

  it('filters empty items after split', () => {
    expect(parseCsv('a,,b,')).toEqual(['a', 'b']);
  });

  it('returns empty array for null', () => {
    expect(parseCsv(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single item without delimiter', () => {
    expect(parseCsv('example.com')).toEqual(['example.com']);
  });

  it('handles mixed comma and newline delimiters', () => {
    expect(parseCsv('a,b\nc,d')).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ---------------------------------------------------------------------------
// parseUpstreams
// ---------------------------------------------------------------------------

describe('parseUpstreams', () => {
  it('splits by newline', () => {
    expect(parseUpstreams('http://a\nhttp://b')).toEqual(['http://a', 'http://b']);
  });

  it('does NOT split on commas (URLs may contain commas in query strings)', () => {
    const url = 'http://example.com/path?a=1,b=2';
    expect(parseUpstreams(url)).toEqual([url]);
  });

  it('trims whitespace from each line', () => {
    expect(parseUpstreams('  backend:8080  \n  backend2:9090  ')).toEqual([
      'backend:8080',
      'backend2:9090',
    ]);
  });

  it('filters empty lines', () => {
    expect(parseUpstreams('a\n\nb\n')).toEqual(['a', 'b']);
  });

  it('returns empty array for null', () => {
    expect(parseUpstreams(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseUpstreams('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseCheckbox
// ---------------------------------------------------------------------------

describe('parseCheckbox', () => {
  it('"on" → true', () => {
    expect(parseCheckbox('on')).toBe(true);
  });

  it('"true" → true', () => {
    expect(parseCheckbox('true')).toBe(true);
  });

  it('"1" → true', () => {
    expect(parseCheckbox('1')).toBe(true);
  });

  it('null → false', () => {
    expect(parseCheckbox(null)).toBe(false);
  });

  it('"off" → false', () => {
    expect(parseCheckbox('off')).toBe(false);
  });

  it('"false" → false', () => {
    expect(parseCheckbox('false')).toBe(false);
  });

  it('"0" → false', () => {
    expect(parseCheckbox('0')).toBe(false);
  });

  it('empty string → false', () => {
    expect(parseCheckbox('')).toBe(false);
  });

  it('arbitrary string → false', () => {
    expect(parseCheckbox('yes')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseOptionalText
// ---------------------------------------------------------------------------

describe('parseOptionalText', () => {
  it('returns trimmed string for non-empty input', () => {
    expect(parseOptionalText('  hello  ')).toBe('hello');
  });

  it('returns the exact string when already trimmed', () => {
    expect(parseOptionalText('hello')).toBe('hello');
  });

  it('returns null for null', () => {
    expect(parseOptionalText(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOptionalText('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseOptionalText('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCertificateId
// ---------------------------------------------------------------------------

describe('parseCertificateId', () => {
  it('parses a valid positive integer', () => {
    expect(parseCertificateId('42')).toBe(42);
  });

  it('parses "1" as 1', () => {
    expect(parseCertificateId('1')).toBe(1);
  });

  it('returns null for null', () => {
    expect(parseCertificateId(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCertificateId('')).toBeNull();
  });

  it('returns null for "0" (must be > 0)', () => {
    expect(parseCertificateId('0')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(parseCertificateId('-1')).toBeNull();
  });

  it('returns null for decimal values', () => {
    expect(parseCertificateId('1.5')).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(parseCertificateId('NaN')).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(parseCertificateId('Infinity')).toBeNull();
  });

  it('returns null for the literal "null"', () => {
    expect(parseCertificateId('null')).toBeNull();
  });

  it('returns null for the literal "undefined"', () => {
    expect(parseCertificateId('undefined')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseCertificateId('abc')).toBeNull();
  });

  it('handles leading/trailing whitespace', () => {
    expect(parseCertificateId('  5  ')).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// parseAccessListId — identical rules to parseCertificateId
// ---------------------------------------------------------------------------

describe('parseAccessListId', () => {
  it('parses a valid positive integer', () => {
    expect(parseAccessListId('7')).toBe(7);
  });

  it('returns null for null', () => {
    expect(parseAccessListId(null)).toBeNull();
  });

  it('returns null for "0"', () => {
    expect(parseAccessListId('0')).toBeNull();
  });

  it('returns null for float', () => {
    expect(parseAccessListId('2.5')).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(parseAccessListId('NaN')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseOptionalNumber
// ---------------------------------------------------------------------------

describe('parseOptionalNumber', () => {
  it('parses integer', () => {
    expect(parseOptionalNumber('42')).toBe(42);
  });

  it('parses float', () => {
    expect(parseOptionalNumber('3.14')).toBe(3.14);
  });

  it('parses negative number', () => {
    expect(parseOptionalNumber('-5')).toBe(-5);
  });

  it('parses zero', () => {
    expect(parseOptionalNumber('0')).toBe(0);
  });

  it('returns null for null', () => {
    expect(parseOptionalNumber(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOptionalNumber('')).toBeNull();
  });

  it('returns null for whitespace-only', () => {
    expect(parseOptionalNumber('   ')).toBeNull();
  });

  it('returns null for NaN text', () => {
    expect(parseOptionalNumber('NaN')).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(parseOptionalNumber('Infinity')).toBeNull();
  });

  it('returns null for non-numeric text', () => {
    expect(parseOptionalNumber('abc')).toBeNull();
  });
});
