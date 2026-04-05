/**
 * Unit tests for the new cert-based mTLS model (leaf override / trusted_client_cert_ids).
 *
 * Tests buildClientAuthentication with the mTlsDomainLeafOverride parameter
 * to ensure the new "trust user X" model works correctly alongside the legacy CA model.
 */
import { describe, it, expect } from 'vitest';
import { buildClientAuthentication, pemToBase64Der } from '../../src/lib/caddy-mtls';

function makeCaPem(label: string): string {
  return `-----BEGIN CERTIFICATE-----\n${label}\n-----END CERTIFICATE-----`;
}

function makeCaCertMap(...entries: [number, string][]) {
  return new Map(entries.map(([id, label]) => [id, { id, certificatePem: makeCaPem(label) }]));
}

describe('buildClientAuthentication with leaf override (new cert-based model)', () => {
  it('uses leaf override PEMs when mTlsDomainLeafOverride is provided', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    const leafOverride = new Map([['app.example.com', [makeCaPem('USER_CERT_1'), makeCaPem('USER_CERT_2')]]]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set(),
      leafOverride
    );

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('require_and_verify');
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
    expect(result!.trusted_leaf_certs).toEqual(['USER_CERT_1', 'USER_CERT_2']);
  });

  it('ignores the legacy managed/unmanaged CA logic when leaf override is present', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    // CA 1 is managed with active certs, but leaf override should take precedence
    const issuedClientCertMap = new Map([[1, [makeCaPem('OTHER_CERT')]]]);
    const cAsWithAnyIssuedCerts = new Set([1]);
    const leafOverride = new Map([['app.example.com', [makeCaPem('SPECIFIC_USER')]]]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      issuedClientCertMap,
      cAsWithAnyIssuedCerts,
      leafOverride
    );

    expect(result).not.toBeNull();
    // Should only have the override leaf, not OTHER_CERT from the managed CA
    expect(result!.trusted_leaf_certs).toEqual(['SPECIFIC_USER']);
    expect(result!.trusted_leaf_certs).not.toContain('OTHER_CERT');
  });

  it('falls back to legacy CA logic when no leaf override exists for domain', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    // No leaf override for this domain
    const leafOverride = new Map([['other.example.com', [makeCaPem('OTHER')]]]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set(),
      leafOverride
    );

    // Falls back to unmanaged CA: no leaf certs
    expect(result).not.toBeNull();
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
    expect(result!.trusted_leaf_certs).toBeUndefined();
  });

  it('includes CAs from multiple domains in leaf override', () => {
    const mTlsDomainMap = new Map([
      ['app.example.com', [1, 2]],
    ]);
    const caCertMap = makeCaCertMap([1, 'CA_A'], [2, 'CA_B']);
    const leafOverride = new Map([['app.example.com', [makeCaPem('USER_1')]]]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set(),
      leafOverride
    );

    expect(result).not.toBeNull();
    expect(result!.trusted_ca_certs).toContain('CA_A');
    expect(result!.trusted_ca_certs).toContain('CA_B');
    expect(result!.trusted_leaf_certs).toEqual(['USER_1']);
  });

  it('deduplicates leaf PEMs from multiple domains in same group', () => {
    const sharedPem = makeCaPem('SHARED_CERT');
    const mTlsDomainMap = new Map([
      ['a.example.com', [1]],
      ['b.example.com', [1]],
    ]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    const leafOverride = new Map([
      ['a.example.com', [sharedPem]],
      ['b.example.com', [sharedPem]],
    ]);

    const result = buildClientAuthentication(
      ['a.example.com', 'b.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set(),
      leafOverride
    );

    expect(result).not.toBeNull();
    // The Set-based dedup in the function should handle this
    // Actually looking at the code, it uses a Set for PEMs
    const leafCerts = result!.trusted_leaf_certs as string[];
    // pemToBase64Der('SHARED_CERT') appears once since we used a Set
    expect(leafCerts.length).toBe(1);
  });

  it('returns null when leaf override has PEMs but no CA exists in caCertMap', () => {
    const mTlsDomainMap = new Map([['app.example.com', [99]]]);
    const caCertMap = new Map<number, { id: number; certificatePem: string }>(); // CA 99 not found
    const leafOverride = new Map([['app.example.com', [makeCaPem('USER')]]]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set(),
      leafOverride
    );

    expect(result).toBeNull();
  });

  it('handles empty leaf override map (same as no override)', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set(),
      new Map()
    );

    // No override → unmanaged CA logic
    expect(result).not.toBeNull();
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
    expect(result!.trusted_leaf_certs).toBeUndefined();
  });

  it('handles undefined leaf override (backward compat)', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set(),
      undefined
    );

    expect(result).not.toBeNull();
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
  });
});
