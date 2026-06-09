import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAllowSelfRegistration(value?: string): Promise<boolean> {
  vi.resetModules();
  if (value === undefined) {
    vi.stubEnv('AUTH_ALLOW_SELF_REGISTRATION', undefined);
  } else {
    vi.stubEnv('AUTH_ALLOW_SELF_REGISTRATION', value);
  }

  const { config } = await import('../../src/lib/config');
  return config.auth.allowSelfRegistration;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('email self-registration configuration', () => {
  it('is disabled when AUTH_ALLOW_SELF_REGISTRATION is unset', async () => {
    expect(await loadAllowSelfRegistration()).toBe(false);
  });

  it('is enabled only when AUTH_ALLOW_SELF_REGISTRATION is exactly true', async () => {
    expect(await loadAllowSelfRegistration('true')).toBe(true);
    expect(await loadAllowSelfRegistration('false')).toBe(false);
    expect(await loadAllowSelfRegistration('TRUE')).toBe(false);
  });
});
