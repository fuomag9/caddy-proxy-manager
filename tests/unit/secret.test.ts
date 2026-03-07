import { describe, it, expect } from 'vitest';
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
});
