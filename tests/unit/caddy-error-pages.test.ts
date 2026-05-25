/**
 * Unit tests for error-page support: the buildErrorPageRoute config builder
 * (src/lib/caddy.ts) and the sanitizeErrorPageRules input sanitizer
 * (src/lib/models/proxy-hosts.ts).
 */
import { describe, it, expect, vi } from 'vitest';

vi.unmock('@/src/lib/caddy');

import { buildErrorPageRoute } from '@/src/lib/caddy';
import { sanitizeErrorPageRules } from '@/src/lib/models/proxy-hosts';

describe('buildErrorPageRoute', () => {
  it('builds a per-host route with host matcher and status expression', () => {
    const route = buildErrorPageRoute(
      { statuses: [502, 503], body: '<h1>down</h1>' },
      ['a.example.com', 'b.example.com']
    );

    expect(route.match).toEqual([
      {
        host: ['a.example.com', 'b.example.com'],
        expression: '{http.error.status_code} == 502 || {http.error.status_code} == 503',
      },
    ]);
    expect(route.terminal).toBe(true);
    expect(route.handle).toEqual([
      {
        handler: 'static_response',
        status_code: '{http.error.status_code}',
        body: '<h1>down</h1>',
        headers: { 'Content-Type': ['text/html; charset=utf-8'] },
      },
    ]);
  });

  it('omits the match block entirely for a global catch-all rule', () => {
    const route = buildErrorPageRoute({ statuses: [], body: 'oops' });
    expect(route.match).toBeUndefined();
    expect(route.handle).toBeDefined();
  });

  it('matches host only when statuses is empty but a host is given', () => {
    const route = buildErrorPageRoute({ statuses: [], body: 'oops' }, ['x.example.com']);
    expect(route.match).toEqual([{ host: ['x.example.com'] }]);
  });

  it('uses a single comparison for one status code', () => {
    const route = buildErrorPageRoute({ statuses: [404], body: 'nope' });
    expect(route.match).toEqual([{ expression: '{http.error.status_code} == 404' }]);
  });

  it('honors a custom content type', () => {
    const route = buildErrorPageRoute({ statuses: [], body: '{}', contentType: 'application/json' });
    const handle = (route.handle as Array<Record<string, unknown>>)[0];
    expect(handle.headers).toEqual({ 'Content-Type': ['application/json'] });
  });
});

describe('sanitizeErrorPageRules', () => {
  it('drops rules without a body', () => {
    expect(sanitizeErrorPageRules([{ statuses: [502], body: '' }])).toEqual([]);
    expect(sanitizeErrorPageRules([{ statuses: [502] }])).toEqual([]);
  });

  it('filters out-of-range and non-integer status codes and dedupes', () => {
    const [rule] = sanitizeErrorPageRules([
      { statuses: [502, 502, 99, 700, 503.5, 404], body: 'x' },
    ]);
    expect(rule.statuses).toEqual([502, 404]);
  });

  it('defaults to empty statuses (all errors) when not an array', () => {
    const [rule] = sanitizeErrorPageRules([{ statuses: 'nope', body: 'x' }]);
    expect(rule.statuses).toEqual([]);
  });

  it('strips CR/LF from contentType to prevent header injection', () => {
    const [rule] = sanitizeErrorPageRules([
      { statuses: [], body: 'x', contentType: 'text/html\r\nX-Evil: 1' },
    ]);
    expect(rule.contentType).toBe('text/htmlX-Evil: 1');
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeErrorPageRules(null)).toEqual([]);
    expect(sanitizeErrorPageRules('foo')).toEqual([]);
  });
});
