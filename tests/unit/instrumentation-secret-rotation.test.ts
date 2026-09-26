/**
 * Startup logging of the SESSION_SECRET rotation pass in instrumentation.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reencryptStoredSecrets: vi.fn(),
}));

vi.mock('../../src/lib/config', () => ({ validateProductionConfig: () => {} }));
vi.mock('../../src/lib/init-db', () => ({ ensureAdminUser: async () => {} }));
vi.mock('../../src/lib/models/certificates', () => ({ migrateLegacyCertificateStorage: async () => 0 }));
vi.mock('../../src/lib/models/ca-certificates', () => ({ migrateLegacyCaPrivateKeys: async () => 0 }));
vi.mock('../../src/lib/secret-rotation', () => ({ reencryptStoredSecrets: mocks.reencryptStoredSecrets }));
vi.mock('../../src/lib/caddy', () => ({ applyCaddyConfig: async () => {} }));
vi.mock('../../src/lib/caddy-monitor', () => ({ startCaddyMonitoring: () => {} }));
vi.mock('../../src/lib/clickhouse/client', () => ({ initClickHouse: async () => {}, closeClickHouse: () => {} }));
// Failing parser start-up keeps register() from installing intervals and SIGTERM handlers.
vi.mock('../../src/lib/log-parser', () => ({
  initLogParser: async () => { throw new Error('not in tests'); },
  parseNewLogEntries: async () => {},
  stopLogParser: () => {},
}));
vi.mock('../../src/lib/waf-log-parser', () => ({
  initWafLogParser: async () => { throw new Error('not in tests'); },
  parseNewWafLogEntries: async () => {},
  stopWafLogParser: () => {},
}));
vi.mock('../../src/lib/instance-sync', () => ({
  getInstanceMode: async () => 'standalone',
  getSyncIntervalMs: () => 0,
  runPeriodicInstanceSync: async () => null,
}));

import { register } from '../../src/instrumentation';

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
}

describe('instrumentation secret rotation logging', () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    process.env.NEXT_RUNTIME = 'nodejs';
  });

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    vi.restoreAllMocks();
  });

  it('summarizes cleared OAuth tokens in one informational line, not as failures', async () => {
    mocks.reencryptStoredSecrets.mockResolvedValue({ reencrypted: 0, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 600 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await register();

    const cleared = log.mock.calls.filter((call) => String(call[0]).includes('OAuth'));
    expect(cleared).toHaveLength(1);
    expect(String(cleared[0][0])).toContain('Cleared 600 stored OAuth sign-in token(s)');
    expect(logged(warn)).not.toMatch(/stored secret|re-enter/);
  });

  it('points to the recovery steps for failed values without claiming features fail', async () => {
    mocks.reencryptStoredSecrets.mockResolvedValue({ reencrypted: 1, encryptedPlaintext: 0, failed: 2, clearedOAuthTokens: 0 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await register();

    expect(logged(log)).toContain('Re-encrypted 1 stored secret(s)');
    expect(logged(log)).not.toContain('OAuth');
    const warnings = logged(warn);
    expect(warnings).toContain('2 stored secret(s) listed above could not be decrypted');
    expect(warnings).toContain('SESSION_SECRET_PREVIOUS');
    expect(warnings).not.toContain('will fail');
  });

  it('reports DNS provider credentials encrypted from plaintext in their own line', async () => {
    mocks.reencryptStoredSecrets.mockResolvedValue({ reencrypted: 0, encryptedPlaintext: 3, failed: 0, clearedOAuthTokens: 0 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await register();

    expect(logged(log)).toContain('Encrypted 3 DNS provider credential(s) that were stored in plaintext');
    expect(logged(log)).not.toContain('Re-encrypted');
    expect(logged(warn)).not.toMatch(/stored secret/);
  });
});
