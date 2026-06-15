import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use the real caddy module (it is globally mocked in setup.vitest.ts).
vi.unmock('@/src/lib/caddy');

// Avoid touching the real DB: buildTlsAutomation calls getDnsProviderSettings()
// unconditionally. Everything else is supplied via options.
vi.mock('@/src/lib/settings', async (orig) => {
  const actual = await orig<typeof import('@/src/lib/settings')>();
  return { ...actual, getDnsProviderSettings: vi.fn().mockResolvedValue(null) };
});

import { buildTlsAutomation } from '@/src/lib/caddy';
import type { AcmeSettings } from '@/src/lib/settings';

const NO_DNS = { enabled: false, resolvers: [] };

// Helper to reach the (only) auto-managed-domain issuer in the result.
async function firstIssuer(acmeSettings: AcmeSettings) {
  const result = await buildTlsAutomation(new Map(), new Set(['example.com']), {
    acmeEmail: 'admin@example.com',
    dnsSettings: NO_DNS,
    acmeSettings,
  });
  const policies = (result.tlsApp as any)?.automation?.policies as any[];
  return policies[0].issuers[0] as Record<string, unknown>;
}

describe('buildTlsAutomation — custom ACME directory', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'acme-ca-'));
    process.env.ACME_CA_ROOT_DIR = tmp;
  });

  afterEach(() => {
    delete process.env.ACME_CA_ROOT_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('uses the Let\'s Encrypt default (no ca field) when caUrl is unset', async () => {
    const issuer = await firstIssuer({});
    expect(issuer.module).toBe('acme');
    expect(issuer).not.toHaveProperty('ca');
    expect(issuer).not.toHaveProperty('trusted_roots_pem_files');
  });

  it('injects ca with a custom directory URL', async () => {
    const issuer = await firstIssuer({ caUrl: 'https://ca.internal.example.com/acme/acme/directory' });
    expect(issuer.ca).toBe('https://ca.internal.example.com/acme/acme/directory');
  });

  it('ignores an empty/whitespace caUrl', async () => {
    const issuer = await firstIssuer({ caUrl: '   ' });
    expect(issuer).not.toHaveProperty('ca');
  });

  it('writes the CA root PEM to the shared path and references it', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    const issuer = await firstIssuer({
      caUrl: 'https://ca.internal.example.com/acme/acme/directory',
      caRootPem: pem,
    });

    const expectedPath = join(tmp, 'custom-ca-root.pem');
    expect(issuer.trusted_roots_pem_files).toEqual([expectedPath]);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, 'utf-8')).toContain(pem);
  });

  it('applies the override to explicitly-managed certificate issuers too', async () => {
    const usage = new Map<number, any>([
      [
        1,
        {
          certificate: {
            id: 1,
            type: 'managed',
            autoRenew: true,
            domainNames: 'managed.example.com',
            providerOptions: null,
          },
          domains: new Set(['managed.example.com']),
        },
      ],
    ]);

    const result = await buildTlsAutomation(usage, new Set(), {
      dnsSettings: NO_DNS,
      acmeSettings: { caUrl: 'https://ca.internal.example.com/acme/acme/directory' },
    });

    const policies = (result.tlsApp as any).automation.policies as any[];
    const issuer = policies[0].issuers[0];
    expect(issuer.ca).toBe('https://ca.internal.example.com/acme/acme/directory');
  });
});
