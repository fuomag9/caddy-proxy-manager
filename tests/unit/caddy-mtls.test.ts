/**
 * Unit tests for src/lib/caddy-mtls.ts
 *
 * Covers:
 *  - pemToBase64Der: PEM stripping
 *  - buildClientAuthentication: CA trust configuration per domain set
 *  - groupMtlsDomainsByCaSet: isolation of CA sets per TLS policy
 *
 * The key bug these tests document and verify the fix for:
 * If two proxy hosts (app.example.com → CA_A, api.example.com → CA_B) share an
 * auto-managed TLS certificate, their mTLS domains must NOT be grouped into a
 * single policy — otherwise a client cert signed by CA_B can authenticate against
 * app.example.com (which only trusts CA_A) and vice-versa.
 */
import { describe, it, expect } from 'vitest';
import {
  pemToBase64Der,
  buildClientAuthentication,
  groupMtlsDomainsByCaSet,
} from '../../src/lib/caddy-mtls';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCaPem(label: string): string {
  return `-----BEGIN CERTIFICATE-----\n${label}\n-----END CERTIFICATE-----`;
}

function makeCaCertMap(...entries: [number, string][]) {
  return new Map(entries.map(([id, label]) => [id, { id, certificatePem: makeCaPem(label) }]));
}

// ---------------------------------------------------------------------------
// pemToBase64Der
// ---------------------------------------------------------------------------

describe('pemToBase64Der', () => {
  it('strips PEM header and footer', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nABCDEFGH\n-----END CERTIFICATE-----';
    expect(pemToBase64Der(pem)).toBe('ABCDEFGH');
  });

  it('strips all whitespace including newlines and spaces', () => {
    const pem = '-----BEGIN CERTIFICATE-----\n  ABCD  \n  EFGH  \n-----END CERTIFICATE-----';
    expect(pemToBase64Der(pem)).toBe('ABCDEFGH');
  });

  it('handles multi-line base64 content', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nAAAA\nBBBB\nCCCC\n-----END CERTIFICATE-----';
    expect(pemToBase64Der(pem)).toBe('AAAABBBBCCCC');
  });

  it('returns only the base64 body without any whitespace', () => {
    const result = pemToBase64Der(makeCaPem('CA_A'));
    expect(result).toBe('CA_A');
    expect(result).not.toMatch(/\s/);
    expect(result).not.toContain('BEGIN');
    expect(result).not.toContain('END');
  });
});

// ---------------------------------------------------------------------------
// buildClientAuthentication
// ---------------------------------------------------------------------------

describe('buildClientAuthentication', () => {
  it('returns null when no domains have mTLS config', () => {
    const result = buildClientAuthentication(
      ['app.example.com'],
      new Map(),
      new Map(),
      new Map(),
      new Set()
    );
    expect(result).toBeNull();
  });

  it('returns null when domain references CA IDs that do not exist in caCertMap', () => {
    const mTlsDomainMap = new Map([['app.example.com', [99]]]);
    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      new Map(), // CA 99 not in map
      new Map(),
      new Set()
    );
    expect(result).toBeNull();
  });

  it('returns mode=require_and_verify and trusted_ca_certs for unmanaged CA', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set() // CA 1 is not managed
    );

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('require_and_verify');
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
    expect(result!.trusted_leaf_certs).toBeUndefined();
  });

  it('pins to CA cert itself when all its issued certs are revoked (fail-closed)', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    const issuedClientCertMap = new Map([[1, []]]); // CA 1 managed, zero active certs
    const cAsWithAnyIssuedCerts = new Set([1]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      issuedClientCertMap,
      cAsWithAnyIssuedCerts
    );

    // Returns a valid client_authentication that no client can satisfy:
    // CA is trusted for chain validation, but leaf is pinned to the CA cert itself
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('require_and_verify');
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
    expect(result!.trusted_leaf_certs).toEqual(['CA_A']); // CA cert as leaf pin → unmatchable
  });

  it('includes CA cert and active leaf certs for managed CA with active certs', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    const leafPem = makeCaPem('LEAF_1');
    const issuedClientCertMap = new Map([[1, [leafPem]]]);
    const cAsWithAnyIssuedCerts = new Set([1]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      issuedClientCertMap,
      cAsWithAnyIssuedCerts
    );

    expect(result).not.toBeNull();
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
    expect(result!.trusted_leaf_certs).toEqual(['LEAF_1']);
  });

  it('includes multiple active leaf certs for managed CA', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    const leafPems = [makeCaPem('LEAF_1'), makeCaPem('LEAF_2'), makeCaPem('LEAF_3')];
    const issuedClientCertMap = new Map([[1, leafPems]]);
    const cAsWithAnyIssuedCerts = new Set([1]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      issuedClientCertMap,
      cAsWithAnyIssuedCerts
    );

    expect(result!.trusted_leaf_certs).toEqual(['LEAF_1', 'LEAF_2', 'LEAF_3']);
  });

  it('mixes unmanaged CA (no leaves) and managed CA (with active leaves) correctly', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1, 2]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A'], [2, 'CA_B']);
    const leafPem = makeCaPem('LEAF_B1');
    // CA 1 is unmanaged; CA 2 is managed with one active cert
    const issuedClientCertMap = new Map([[2, [leafPem]]]);
    const cAsWithAnyIssuedCerts = new Set([2]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      issuedClientCertMap,
      cAsWithAnyIssuedCerts
    );

    expect(result!.trusted_ca_certs).toContain('CA_A');
    expect(result!.trusted_ca_certs).toContain('CA_B');
    expect(result!.trusted_leaf_certs).toEqual(['LEAF_B1']);
  });

  it('returns fail-closed config when the only configured CA is managed with all certs revoked', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const caCertMap = makeCaCertMap([1, 'CA_A']);
    const issuedClientCertMap = new Map([[1, []]]);
    const cAsWithAnyIssuedCerts = new Set([1]);

    const result = buildClientAuthentication(
      ['app.example.com'],
      mTlsDomainMap,
      caCertMap,
      issuedClientCertMap,
      cAsWithAnyIssuedCerts
    );
    // Must NOT return null — returns a valid but unsatisfiable client_authentication
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('require_and_verify');
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
    expect(result!.trusted_leaf_certs).toEqual(['CA_A']); // poison-pill → no client can match
  });

  it('domain lookup is case-insensitive', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]); // lowercase key
    const caCertMap = makeCaCertMap([1, 'CA_A']);

    const result = buildClientAuthentication(
      ['APP.EXAMPLE.COM'], // uppercase input
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set()
    );

    expect(result).not.toBeNull();
    expect(result!.trusted_ca_certs).toEqual(['CA_A']);
  });
});

// ---------------------------------------------------------------------------
// groupMtlsDomainsByCaSet
// ---------------------------------------------------------------------------

describe('groupMtlsDomainsByCaSet', () => {
  it('returns empty map for empty input', () => {
    expect(groupMtlsDomainsByCaSet([], new Map()).size).toBe(0);
  });

  it('puts a single domain in its own group', () => {
    const mTlsDomainMap = new Map([['app.example.com', [1]]]);
    const groups = groupMtlsDomainsByCaSet(['app.example.com'], mTlsDomainMap);
    expect(groups.size).toBe(1);
    const [group] = groups.values();
    expect(group).toEqual(['app.example.com']);
  });

  it('groups two domains with the same single CA into one group', () => {
    const mTlsDomainMap = new Map([
      ['app.example.com', [1]],
      ['app2.example.com', [1]],
    ]);
    const groups = groupMtlsDomainsByCaSet(
      ['app.example.com', 'app2.example.com'],
      mTlsDomainMap
    );
    expect(groups.size).toBe(1);
    const [group] = groups.values();
    expect(group).toHaveLength(2);
    expect(group).toContain('app.example.com');
    expect(group).toContain('app2.example.com');
  });

  it('separates domains with different CA sets — the cross-CA isolation test', () => {
    // This is the core bug scenario: two hosts with different CAs must each get
    // their own TLS policy so CA_B certs cannot authenticate against the CA_A host.
    const mTlsDomainMap = new Map([
      ['app.example.com', [1]], // trusts CA_A only
      ['api.example.com', [2]], // trusts CA_B only
    ]);
    const groups = groupMtlsDomainsByCaSet(
      ['app.example.com', 'api.example.com'],
      mTlsDomainMap
    );
    expect(groups.size).toBe(2);

    const groupValues = Array.from(groups.values());
    const appGroup = groupValues.find(g => g.includes('app.example.com'));
    const apiGroup = groupValues.find(g => g.includes('api.example.com'));

    expect(appGroup).toEqual(['app.example.com']);
    expect(apiGroup).toEqual(['api.example.com']);
  });

  it('groups domains with the same multi-CA set together regardless of CA order', () => {
    const mTlsDomainMap = new Map([
      ['app.example.com', [1, 2]],
      ['app2.example.com', [2, 1]], // same CAs, different order
    ]);
    const groups = groupMtlsDomainsByCaSet(
      ['app.example.com', 'app2.example.com'],
      mTlsDomainMap
    );
    expect(groups.size).toBe(1);
    const [group] = groups.values();
    expect(group).toHaveLength(2);
  });

  it('separates domains with subset vs superset CAs', () => {
    const mTlsDomainMap = new Map([
      ['app.example.com', [1]],       // trusts CA_A only
      ['api.example.com', [1, 2]],    // trusts CA_A + CA_B
    ]);
    const groups = groupMtlsDomainsByCaSet(
      ['app.example.com', 'api.example.com'],
      mTlsDomainMap
    );
    expect(groups.size).toBe(2);
  });

  it('creates three groups for three different CA sets', () => {
    const mTlsDomainMap = new Map([
      ['a.example.com', [1]],
      ['b.example.com', [2]],
      ['c.example.com', [3]],
    ]);
    const groups = groupMtlsDomainsByCaSet(
      ['a.example.com', 'b.example.com', 'c.example.com'],
      mTlsDomainMap
    );
    expect(groups.size).toBe(3);
  });

  it('correctly handles a mix: two shared, one unique', () => {
    const mTlsDomainMap = new Map([
      ['shared1.example.com', [1]],
      ['shared2.example.com', [1]],
      ['unique.example.com', [2]],
    ]);
    const groups = groupMtlsDomainsByCaSet(
      ['shared1.example.com', 'shared2.example.com', 'unique.example.com'],
      mTlsDomainMap
    );
    expect(groups.size).toBe(2);

    const groupValues = Array.from(groups.values());
    const sharedGroup = groupValues.find(g => g.length === 2);
    const uniqueGroup = groupValues.find(g => g.length === 1);

    expect(sharedGroup).toContain('shared1.example.com');
    expect(sharedGroup).toContain('shared2.example.com');
    expect(uniqueGroup).toContain('unique.example.com');
  });

  it('domain with empty CA list gets its own group (key="")', () => {
    // Edge case: domain in mTlsDomainMap but with an empty CA ID list
    const mTlsDomainMap = new Map([
      ['app.example.com', [1]],
      ['noca.example.com', []],
    ]);
    const groups = groupMtlsDomainsByCaSet(
      ['app.example.com', 'noca.example.com'],
      mTlsDomainMap
    );
    // Two distinct groups: key="1" and key=""
    expect(groups.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-CA isolation integration: groupMtlsDomainsByCaSet + buildClientAuthentication
// ---------------------------------------------------------------------------

describe('mTLS per-host CA isolation (regression test for cross-CA bug)', () => {
  const caCertMap = makeCaCertMap([1, 'CA_A'], [2, 'CA_B']);

  it('before the fix (union): calling buildClientAuthentication with both domains together gives both CAs', () => {
    // This documents the OLD behavior — the caller should NOT do this.
    const mTlsDomainMap = new Map([
      ['app.example.com', [1]],
      ['api.example.com', [2]],
    ]);
    const result = buildClientAuthentication(
      ['app.example.com', 'api.example.com'], // both domains in one call — wrong
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set()
    );
    // Both CAs end up trusted — this is the unsafe behavior
    expect(result!.trusted_ca_certs).toContain('CA_A');
    expect(result!.trusted_ca_certs).toContain('CA_B');
  });

  it('after the fix (grouping): each domain gets a policy with only its own CA', () => {
    const mTlsDomainMap = new Map([
      ['app.example.com', [1]], // trusts CA_A only
      ['api.example.com', [2]], // trusts CA_B only
    ]);
    const allMtlsDomains = ['app.example.com', 'api.example.com'];
    const groups = groupMtlsDomainsByCaSet(allMtlsDomains, mTlsDomainMap);

    const policies: { sni: string[]; trusted_ca_certs: unknown[] }[] = [];
    for (const domainGroup of groups.values()) {
      const auth = buildClientAuthentication(
        domainGroup,
        mTlsDomainMap,
        caCertMap,
        new Map(),
        new Set()
      );
      if (auth) {
        policies.push({
          sni: domainGroup,
          trusted_ca_certs: auth.trusted_ca_certs as unknown[],
        });
      }
    }

    expect(policies).toHaveLength(2);

    const appPolicy = policies.find(p => p.sni.includes('app.example.com'))!;
    const apiPolicy = policies.find(p => p.sni.includes('api.example.com'))!;

    // app.example.com policy must ONLY trust CA_A
    expect(appPolicy.trusted_ca_certs).toContain('CA_A');
    expect(appPolicy.trusted_ca_certs).not.toContain('CA_B');

    // api.example.com policy must ONLY trust CA_B
    expect(apiPolicy.trusted_ca_certs).toContain('CA_B');
    expect(apiPolicy.trusted_ca_certs).not.toContain('CA_A');
  });

  it('three hosts each with different CAs get three separate policies', () => {
    const caCertMapExtended = makeCaCertMap([1, 'CA_A'], [2, 'CA_B'], [3, 'CA_C']);
    const mTlsDomainMap = new Map([
      ['a.example.com', [1]],
      ['b.example.com', [2]],
      ['c.example.com', [3]],
    ]);
    const allMtlsDomains = ['a.example.com', 'b.example.com', 'c.example.com'];
    const groups = groupMtlsDomainsByCaSet(allMtlsDomains, mTlsDomainMap);

    expect(groups.size).toBe(3);

    const policies: { sni: string[]; trusted_ca_certs: unknown[] }[] = [];
    for (const domainGroup of groups.values()) {
      const auth = buildClientAuthentication(
        domainGroup,
        mTlsDomainMap,
        caCertMapExtended,
        new Map(),
        new Set()
      );
      if (auth) {
        policies.push({ sni: domainGroup, trusted_ca_certs: auth.trusted_ca_certs as unknown[] });
      }
    }

    expect(policies).toHaveLength(3);

    const aPolicy = policies.find(p => p.sni.includes('a.example.com'))!;
    expect(aPolicy.trusted_ca_certs).toEqual(['CA_A']);
    expect(aPolicy.trusted_ca_certs).not.toContain('CA_B');
    expect(aPolicy.trusted_ca_certs).not.toContain('CA_C');
  });

  it('two hosts sharing the same CA are correctly grouped into one policy', () => {
    const mTlsDomainMap = new Map([
      ['app.example.com', [1]],
      ['app2.example.com', [1]], // same CA
    ]);
    const allMtlsDomains = ['app.example.com', 'app2.example.com'];
    const groups = groupMtlsDomainsByCaSet(allMtlsDomains, mTlsDomainMap);

    expect(groups.size).toBe(1);

    const [domainGroup] = groups.values();
    const auth = buildClientAuthentication(
      domainGroup,
      mTlsDomainMap,
      caCertMap,
      new Map(),
      new Set()
    );

    expect(auth).not.toBeNull();
    expect(auth!.trusted_ca_certs).toEqual(['CA_A']);
    // Both domains in the same policy
    expect(domainGroup).toContain('app.example.com');
    expect(domainGroup).toContain('app2.example.com');
  });
});
