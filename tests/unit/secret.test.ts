import { describe, it, expect, vi, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncryptedSecret } from '@/src/lib/secret';

describe('secret', () => {
  it('encrypts a value (output is non-empty string)', () => {
    const encrypted = encryptSecret('my-api-token');
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it('encrypted value starts with "enc:v1:" prefix', () => {
    const encrypted = encryptSecret('hello-world');
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
  });

  it('same input produces different output each time (random IV)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    // Different because IV is random
    expect(a).not.toBe(b);
  });

  it('different inputs produce different outputs', () => {
    const a = encryptSecret('value-one');
    const b = encryptSecret('value-two');
    expect(a).not.toBe(b);
  });

  it('decrypts back to original value', () => {
    const original = 'super-secret-token-12345';
    const encrypted = encryptSecret(original);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(original);
  });

  it('decryptSecret with plain text (non-encrypted) returns input unchanged', () => {
    const plain = 'not-encrypted-value';
    expect(decryptSecret(plain)).toBe(plain);
  });

  it('isEncryptedSecret returns true for encrypted values', () => {
    const encrypted = encryptSecret('test');
    expect(isEncryptedSecret(encrypted)).toBe(true);
  });

  it('isEncryptedSecret returns false for plain text', () => {
    expect(isEncryptedSecret('plain-text')).toBe(false);
  });

  it('encrypting empty string returns empty string', () => {
    expect(encryptSecret('')).toBe('');
  });

  it('decrypting empty string returns empty string', () => {
    expect(decryptSecret('')).toBe('');
  });

  it('already-encrypted value is not double-encrypted', () => {
    const encrypted = encryptSecret('value');
    const encrypted2 = encryptSecret(encrypted);
    // Should return the same value (idempotent)
    expect(encrypted2).toBe(encrypted);
  });

  const savedEnv: Record<string, string | undefined> = {};

  /** Set an env var until the end of the test; the first call saves the original. */
  function withEnv(key: string, value: string | undefined) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
      delete savedEnv[key];
    }
    vi.resetModules();
  });

  /** A fresh copy of the module that sees the current environment. */
  async function loadSecretModule() {
    vi.resetModules();
    return await import('@/src/lib/secret');
  }

  describe('failure diagnostics (SESSION_SECRET changed)', () => {

    it('grace period expired: error includes context, cause and recovery hint', async () => {
      withEnv('SESSION_SECRET', 'a'.repeat(32));
      withEnv('LEGACY_KEY_CUTOFF_DATE', '2020-01-01T00:00:00Z');
      vi.resetModules();
      const first = await import('@/src/lib/secret');
      const encrypted = first.encryptSecret('token-value');

      withEnv('SESSION_SECRET', 'b'.repeat(32));
      vi.resetModules();
      const second = await import('@/src/lib/secret');

      expect(() => second.decryptSecret(encrypted, 'DNS provider "cloudflare" credential "api_token"')).toThrow(
        /DNS provider "cloudflare" credential "api_token"/
      );
      expect(() => second.decryptSecret(encrypted)).toThrow(/SESSION_SECRET changed/);
      expect(() => second.decryptSecret(encrypted)).toThrow(/LEGACY_KEY_CUTOFF_DATE=never/);
    });

    it('legacy support enabled: error reports failure with both keys', async () => {
      withEnv('SESSION_SECRET', 'c'.repeat(32));
      withEnv('LEGACY_KEY_CUTOFF_DATE', 'never');
      vi.resetModules();
      const first = await import('@/src/lib/secret');
      const encrypted = first.encryptSecret('token-value');

      withEnv('SESSION_SECRET', 'd'.repeat(32));
      vi.resetModules();
      const second = await import('@/src/lib/secret');

      expect(() => second.decryptSecret(encrypted, 'certificate "my-cert"')).toThrow(/certificate "my-cert"/);
      expect(() => second.decryptSecret(encrypted)).toThrow(/HKDF\).*legacy/);
      expect(() => second.decryptSecret(encrypted)).toThrow(/SESSION_SECRET changed/);
      expect(() => second.decryptSecret(encrypted)).toThrow(/set SESSION_SECRET_PREVIOUS/);
    });
  });

  describe('previous secrets (SESSION_SECRET rotation)', () => {
    const OLD_SECRET = 'old-secret-that-was-rotated-away-0123456789';
    const NEW_SECRET = 'new-secret-after-the-rotation-9876543210abc';

    it('decrypts with any SESSION_SECRET_PREVIOUS entry but encrypts only with the current key', async () => {
      withEnv('SESSION_SECRET', OLD_SECRET);
      const before = await loadSecretModule();
      const stored = before.encryptSecret('dns-api-token');

      withEnv('SESSION_SECRET', NEW_SECRET);
      withEnv('SESSION_SECRET_PREVIOUS', `unrelated-secret-abcdefghijklmnopqrstuvwxyz,${OLD_SECRET}`);
      const after = await loadSecretModule();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(after.decryptSecret(stored)).toBe('dns-api-token');
      // Synced values on a slave are not re-encrypted at startup, so the
      // warning must not promise that.
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Keep SESSION_SECRET_PREVIOUS set/));
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/on the next start/));
      warn.mockRestore();

      // A value encrypted now does not decrypt with the old secret alone.
      const fresh = after.encryptSecret('new-token');
      withEnv('SESSION_SECRET', OLD_SECRET);
      withEnv('SESSION_SECRET_PREVIOUS', undefined);
      const oldOnly = await loadSecretModule();
      expect(() => oldOnly.decryptSecret(fresh)).toThrow(/Failed to decrypt/);
    });

    it('decrypts values stored under a rejected placeholder secret without configuration', async () => {
      withEnv('SESSION_SECRET', 'your-secure-session-secret-here-min-32-chars');
      const before = await loadSecretModule();
      const stored = before.encryptSecret('client-secret');

      withEnv('SESSION_SECRET', NEW_SECRET);
      withEnv('SESSION_SECRET_PREVIOUS', undefined);
      const after = await loadSecretModule();
      expect(after.decryptSecret(stored)).toBe('client-secret');
    });

    it('still fails for a key that is neither current nor previous', async () => {
      withEnv('SESSION_SECRET', OLD_SECRET);
      const before = await loadSecretModule();
      const stored = before.encryptSecret('token');

      withEnv('SESSION_SECRET', NEW_SECRET);
      withEnv('SESSION_SECRET_PREVIOUS', 'some-other-secret-abcdefghijklmnopqrstuvwxyz');
      const after = await loadSecretModule();
      expect(() => after.decryptSecret(stored)).toThrow(/SESSION_SECRET_PREVIOUS/);
    });

    it('reencryptSecret re-encrypts only values that need a previous key', async () => {
      withEnv('SESSION_SECRET', OLD_SECRET);
      const before = await loadSecretModule();
      const stored = before.encryptSecret('private-key');

      withEnv('SESSION_SECRET', NEW_SECRET);
      withEnv('SESSION_SECRET_PREVIOUS', OLD_SECRET);
      const after = await loadSecretModule();
      const current = after.encryptSecret('already-current');

      expect(after.reencryptSecret('')).toBeNull();
      expect(after.reencryptSecret('plaintext-value')).toBeNull();
      expect(after.reencryptSecret(current)).toBeNull();

      const rotated = after.reencryptSecret(stored);
      expect(rotated).not.toBeNull();
      expect(rotated).not.toBe(stored);
      expect(after.reencryptSecret(rotated!)).toBeNull();

      // The re-encrypted value no longer needs the previous secret.
      withEnv('SESSION_SECRET_PREVIOUS', undefined);
      const newOnly = await loadSecretModule();
      expect(newOnly.decryptSecret(rotated!)).toBe('private-key');
      expect(() => newOnly.decryptSecret(stored)).toThrow(/Failed to decrypt/);
    });

    it('reencryptSecret throws when no key decrypts the value', async () => {
      withEnv('SESSION_SECRET', OLD_SECRET);
      const before = await loadSecretModule();
      const stored = before.encryptSecret('token');

      withEnv('SESSION_SECRET', NEW_SECRET);
      withEnv('SESSION_SECRET_PREVIOUS', undefined);
      const after = await loadSecretModule();
      expect(() => after.reencryptSecret(stored, 'instance "slave" API token')).toThrow(/instance "slave" API token/);
    });
  });
});
