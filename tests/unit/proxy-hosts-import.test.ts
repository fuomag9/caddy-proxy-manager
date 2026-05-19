/**
 * Unit tests for src/lib/proxy-hosts-import.ts
 * Tests the dispatcher that routes to the JSON or Caddyfile parser based on input shape.
 */
import { describe, it, expect } from 'vitest';
import { parseProxyHostsImport } from '@/lib/proxy-hosts-import';

describe('parseProxyHostsImport', () => {
  it('returns an empty Caddyfile result for empty input', () => {
    const result = parseProxyHostsImport('');
    expect(result.drafts).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.format).toBe('caddyfile');
  });

  it('dispatches to the Caddyfile parser for non-JSON input', () => {
    const input = `a.test.fr {
  reverse_proxy 1.2.3.4:80
}`;
    const result = parseProxyHostsImport(input);
    expect(result.format).toBe('caddyfile');
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].domains).toEqual(['a.test.fr']);
    expect(result.drafts[0].upstream).toBe('1.2.3.4:80');
    expect(result.drafts[0].source).toEqual({
      format: 'caddyfile',
      locator: 'lines 1-3',
    });
  });

  it('adapts Caddyfile parse errors to the unified ImportError shape', () => {
    const input = `a.test.fr {
  tls foo@bar
  reverse_proxy 1.2.3.4:80
}`;
    const result = parseProxyHostsImport(input);
    expect(result.format).toBe('caddyfile');
    expect(result.drafts).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].locator).toMatch(/lines \d+-\d+/);
    expect(result.errors[0].message).toContain('Unsupported directive');
  });

  it('dispatches to the JSON parser when input starts with "{"', () => {
    const input = '{"apps":{}}';
    const result = parseProxyHostsImport(input);
    expect(result.format).toBe('caddy-json');
  });

  it('dispatches to the JSON parser when input has leading whitespace then "{"', () => {
    const input = '   \n\t{"apps":{}}';
    const result = parseProxyHostsImport(input);
    expect(result.format).toBe('caddy-json');
  });

  it('dispatches to the JSON parser when input starts with a UTF-8 BOM then "{"', () => {
    const input = '\uFEFF{"apps":{"http":{"servers":{}}}}';
    const result = parseProxyHostsImport(input);
    expect(result.format).toBe('caddy-json');
    expect(result.errors).toEqual([]);
  });
});
