import { describe, it, expect } from 'vitest';
import { isDomainCoveredByWildcard, isDomainCoveredByCert } from '@/src/lib/cert-domain-match';

describe('isDomainCoveredByWildcard', () => {
  it('wildcard *.example.com covers sub.example.com', () => {
    expect(isDomainCoveredByWildcard('sub.example.com', ['*.example.com'])).toBe(true);
  });

  it('wildcard *.example.com does not cover example.com itself', () => {
    expect(isDomainCoveredByWildcard('example.com', ['*.example.com'])).toBe(false);
  });

  it('wildcard *.example.com does not cover deep subdomain sub.sub.example.com', () => {
    expect(isDomainCoveredByWildcard('sub.sub.example.com', ['*.example.com'])).toBe(false);
  });

  it('wildcard *.example.com does not cover unrelated.com', () => {
    expect(isDomainCoveredByWildcard('unrelated.com', ['*.example.com'])).toBe(false);
  });

  it('returns false when no wildcards present', () => {
    expect(isDomainCoveredByWildcard('sub.example.com', ['example.com', 'other.com'])).toBe(false);
  });

  it('wildcard *.domain.de covers app.domain.de', () => {
    expect(isDomainCoveredByWildcard('app.domain.de', ['*.domain.de'])).toBe(true);
  });

  it('does not match partial suffix (notexample.com)', () => {
    expect(isDomainCoveredByWildcard('notexample.com', ['*.example.com'])).toBe(false);
  });
});

describe('isDomainCoveredByCert', () => {
  const certDomains = ['domain.de', '*.domain.de'];

  it('exact match: domain.de is covered', () => {
    expect(isDomainCoveredByCert('domain.de', certDomains)).toBe(true);
  });

  it('wildcard match: sub.domain.de is covered', () => {
    expect(isDomainCoveredByCert('sub.domain.de', certDomains)).toBe(true);
  });

  it('deep subdomain: a.b.domain.de is NOT covered', () => {
    expect(isDomainCoveredByCert('a.b.domain.de', certDomains)).toBe(false);
  });

  it('unrelated domain is NOT covered', () => {
    expect(isDomainCoveredByCert('other.com', certDomains)).toBe(false);
  });

  it('works with only wildcard (no explicit base)', () => {
    expect(isDomainCoveredByCert('sub.example.com', ['*.example.com'])).toBe(true);
    expect(isDomainCoveredByCert('example.com', ['*.example.com'])).toBe(false);
  });

  it('works with only explicit domain (no wildcard)', () => {
    expect(isDomainCoveredByCert('example.com', ['example.com'])).toBe(true);
    expect(isDomainCoveredByCert('sub.example.com', ['example.com'])).toBe(false);
  });
});
