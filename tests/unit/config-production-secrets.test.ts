/**
 * Production validation rejects the example secrets shipped in .env.example
 * and the README (current and earlier versions). Outside a Next bundle, where
 * NODE_ENV is not inlined, any non-development runtime counts as production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STRONG_SECRET = 'q7Jm2vX9pL4rT8wZ1nB6cH3kF5sD0gA2yE7uR4tW';

async function loadConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import('@/src/lib/config')).config;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('production secret validation', () => {
  it('rejects the .env.example session secret placeholder', async () => {
    const config = await loadConfig({
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'nodejs',
      SESSION_SECRET: 'your-secure-session-secret-here-min-32-chars',
    });
    expect(() => config.sessionSecret).toThrow(/placeholder/);
    // The operator is told that switching away from it keeps stored secrets.
    expect(() => config.sessionSecret).toThrow(/re-encrypted .* automatically/);
    expect(() => config.sessionSecret).toThrow(/SESSION_SECRET_PREVIOUS/);
  });

  it.each([
    'Your-Secure-P@ssw0rd-Here!',
    'YourStr0ng-P@ssw0rd123!',
    'YourStr0ng-P@ssw0rd!',
    'Your-Str0ng-P@ssw0rd!',
  ])(
    'rejects the documented example admin password %s',
    async (password) => {
      const config = await loadConfig({
        NODE_ENV: 'production',
        NEXT_RUNTIME: 'nodejs',
        SESSION_SECRET: STRONG_SECRET,
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: password,
      });
      expect(() => config.adminPassword).toThrow(/example value/);
    }
  );

  it('applies production checks to an unrecognized NODE_ENV outside a Next bundle', async () => {
    const config = await loadConfig({
      NODE_ENV: 'staging',
      NEXT_RUNTIME: 'nodejs',
      SESSION_SECRET: STRONG_SECRET,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin',
    });
    expect(() => config.adminPassword).toThrow(/ADMIN_PASSWORD/);
  });

  it('accepts real credentials in production', async () => {
    const config = await loadConfig({
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'nodejs',
      SESSION_SECRET: STRONG_SECRET,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'Operator-Chosen-2026!',
    });
    expect(config.adminPassword).toBe('Operator-Chosen-2026!');
    expect(config.sessionSecret).toBe(STRONG_SECRET);
  });
});

describe('SESSION_SECRET_PREVIOUS', () => {
  it('is empty when unset', async () => {
    const config = await loadConfig({ SESSION_SECRET_PREVIOUS: '' });
    expect(config.previousSessionSecrets).toEqual([]);
  });

  it('accepts a comma-separated list and keeps the whole value as one entry', async () => {
    const config = await loadConfig({ SESSION_SECRET_PREVIOUS: ' old-secret-one , old-secret-two ' });
    expect(config.previousSessionSecrets).toEqual([
      'old-secret-one , old-secret-two',
      'old-secret-one',
      'old-secret-two',
    ]);
  });

  it('is not subject to the production checks', async () => {
    const config = await loadConfig({
      NODE_ENV: 'production',
      NEXT_RUNTIME: 'nodejs',
      SESSION_SECRET: STRONG_SECRET,
      SESSION_SECRET_PREVIOUS: 'your-secure-session-secret-here-min-32-chars',
    });
    expect(config.sessionSecret).toBe(STRONG_SECRET);
    expect(config.previousSessionSecrets).toEqual(['your-secure-session-secret-here-min-32-chars']);
  });
});
