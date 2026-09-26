/**
 * Sealing of instance sync secrets to the receiving slave's X25519 key
 * (src/lib/sync-crypto.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const ctx = vi.hoisted(() => ({
  config: {
    sessionSecret: 'slave-secret-for-sync-crypto-tests-0123456789',
    previousSessionSecrets: [] as string[],
  },
  zeroSharedSecret: false,
}));

vi.mock('../../src/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/config')>()),
  config: ctx.config,
}));
// OpenSSL and BoringSSL refuse the key exchange with a low-order point; this
// stands in for a runtime that returns the all-zero shared secret instead.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    diffieHellman: (options: Parameters<typeof actual.diffieHellman>[0]) =>
      ctx.zeroSharedSecret ? Buffer.alloc(32) : actual.diffieHellman(options),
  };
});

import {
  SEALED_SYNC_SECRET_PREFIX,
  SyncSealError,
  consumeSyncNonce,
  createSyncKeyResponse,
  getSyncPublicKey,
  issueSyncNonce,
  openSyncSecret,
  parseSyncPublicKeyResponse,
  sealSyncSecret,
  type SyncSealErrorCode,
} from '../../src/lib/sync-crypto';

const SLAVE_SECRET = 'slave-secret-for-sync-crypto-tests-0123456789';
const OTHER_SECRET = 'other-secret-for-sync-crypto-tests-9876543210';
const AAD = JSON.stringify(['settings', 'dns_provider', 'providers', 'cloudflare', 'api_token']);
const PLAINTEXT = 'cloudflare-api-token-sentinel';
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function useSecret(secret: string) {
  ctx.config.sessionSecret = secret;
}

afterEach(() => {
  useSecret(SLAVE_SECRET);
  vi.useRealTimers();
});

function sealError(fn: () => unknown): SyncSealErrorCode {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SyncSealError);
    return (error as SyncSealError).code;
  }
  throw new Error('expected a SyncSealError');
}

/** The bytes after the prefix: ephemeral key (32), IV (12), tag (16), ciphertext. */
function sealedBytes(sealed: string): Buffer {
  return Buffer.from(sealed.slice(SEALED_SYNC_SECRET_PREFIX.length), 'base64url');
}

function resealed(bytes: Buffer): string {
  return `${SEALED_SYNC_SECRET_PREFIX}${bytes.toString('base64url')}`;
}

describe('slave sync key', () => {
  it('is derived from SESSION_SECRET: the same secret gives the same key, another secret another key', () => {
    const first = getSyncPublicKey();
    expect(first.publicKey).toHaveLength(32);
    expect(getSyncPublicKey()).toEqual(first);

    useSecret(OTHER_SECRET);
    const other = getSyncPublicKey();
    expect(other.publicKey.equals(first.publicKey)).toBe(false);
    expect(other.keyId).not.toBe(first.keyId);

    useSecret(SLAVE_SECRET);
    expect(getSyncPublicKey()).toEqual(first);
  });

  it('is published as the raw public key with a key id from its SHA-256, and a new nonce each time', () => {
    const response = createSyncKeyResponse();
    const raw = Buffer.from(response.publicKey, 'base64');

    expect(response).toEqual({
      version: 1,
      algorithm: 'x25519-hkdf-sha256-aes256gcm',
      publicKey: expect.any(String),
      keyId: createHash('sha256').update(raw).digest('hex').slice(0, 16),
      nonce: expect.stringMatching(NONCE_PATTERN),
    });
    expect(raw.equals(getSyncPublicKey().publicKey)).toBe(true);
    expect(JSON.stringify(response)).not.toContain(SLAVE_SECRET);

    const next = createSyncKeyResponse();
    expect(next).toEqual({ ...response, nonce: expect.stringMatching(NONCE_PATTERN) });
    expect(next.nonce).not.toBe(response.nonce);
  });

  it('matches a known answer, so the key derivation and the sealed format stay compatible', () => {
    // Generated once with the Bun runtime the web image uses.
    useSecret('sync-crypto-known-answer-secret-0123456789abcdef');
    expect(createSyncKeyResponse()).toEqual({
      version: 1,
      algorithm: 'x25519-hkdf-sha256-aes256gcm',
      publicKey: '4c6LPuovp6puoEYG/yeNRjvRfSO3PK3m4GtH49HPdDk=',
      keyId: '6d07e10c67df5f33',
      nonce: expect.stringMatching(NONCE_PATTERN),
    });
    const sealed = 'sealed:v1:VrDQcJWZXSBvBQ7rJZ6czavmEznPuGBYmrnuK8_oPHAywzQ8ehPDr-Ji5JddCqXHyGEUUbsObA7wZ-PTDsnneVYRr4XGEXgnGbW7hGzbfRDKnQ';
    expect(openSyncSecret(sealed, AAD)).toBe('known-answer-plaintext');
  });
});

describe('sealSyncSecret / openSyncSecret', () => {
  it('round-trips, with a fresh ephemeral key and IV for every value', () => {
    const { publicKey } = getSyncPublicKey();
    const first = sealSyncSecret(PLAINTEXT, publicKey, AAD);
    const second = sealSyncSecret(PLAINTEXT, publicKey, AAD);

    expect(first.startsWith('sealed:v1:')).toBe(true);
    expect(first).not.toContain(PLAINTEXT);
    expect(first).not.toBe(second);
    expect(sealedBytes(first).subarray(0, 32).equals(sealedBytes(second).subarray(0, 32))).toBe(false);
    expect(openSyncSecret(first, AAD)).toBe(PLAINTEXT);
    expect(openSyncSecret(second, AAD)).toBe(PLAINTEXT);
  });

  it.each(['', 'ünïcödé ✓ -----BEGIN PRIVATE KEY-----\nline\n', 'x'.repeat(10_000)])(
    'round-trips %j',
    (value) => {
      expect(openSyncSecret(sealSyncSecret(value, getSyncPublicKey().publicKey, AAD), AAD)).toBe(value);
    }
  );

  it('does not open under another key', () => {
    const sealed = sealSyncSecret(PLAINTEXT, getSyncPublicKey().publicKey, AAD);

    useSecret(OTHER_SECRET);
    expect(sealError(() => openSyncSecret(sealed, AAD))).toBe('open_failed');
  });

  it('does not open with other associated data, so a value moved to another place fails', () => {
    const sealed = sealSyncSecret(PLAINTEXT, getSyncPublicKey().publicKey, AAD);
    const otherPlace = JSON.stringify(['settings', 'dns_provider', 'providers', 'route53', 'secret_access_key']);

    expect(sealError(() => openSyncSecret(sealed, otherPlace))).toBe('open_failed');
    expect(sealError(() => openSyncSecret(sealed, ''))).toBe('open_failed');
  });

  it.each([
    ['ephemeral key', 0, 0x01],
    // X25519 ignores this bit; the key derivation covers the bytes as sent.
    ['ephemeral key bit X25519 masks', 31, 0x80],
    ['IV', 32, 0x01],
    ['tag', 44, 0x01],
    ['ciphertext', 60, 0x01],
  ])('does not open when the %s changes', (_part, index, mask) => {
    const bytes = sealedBytes(sealSyncSecret(PLAINTEXT, getSyncPublicKey().publicKey, AAD));
    bytes[index] ^= mask;

    expect(sealError(() => openSyncSecret(resealed(bytes), AAD))).toBe('open_failed');
  });

  it('does not open a truncated or extended ciphertext', () => {
    const bytes = sealedBytes(sealSyncSecret(PLAINTEXT, getSyncPublicKey().publicKey, AAD));

    expect(sealError(() => openSyncSecret(resealed(bytes.subarray(0, bytes.length - 1)), AAD))).toBe('open_failed');
    expect(sealError(() => openSyncSecret(resealed(Buffer.concat([bytes, Buffer.from([0])])), AAD))).toBe('open_failed');
  });

  it.each([
    ['plaintext', PLAINTEXT],
    ['an encrypted secret', 'enc:v1:aaaa:bbbb:cccc'],
    ['no data', 'sealed:v1:'],
    ['characters outside base64url', 'sealed:v1:AAAA+/AA'],
    ['too few bytes', resealed(Buffer.alloc(59))],
  ])('rejects %s as malformed', (_case, value) => {
    expect(sealError(() => openSyncSecret(value, AAD))).toBe('malformed');
  });

  it.each([
    ['too short', Buffer.alloc(31, 1)],
    ['too long', Buffer.alloc(33, 1)],
    // The all-zero point gives an all-zero shared secret.
    ['a low-order point', Buffer.alloc(32)],
  ])('refuses a recipient key that is %s', (_case, key) => {
    expect(sealError(() => sealSyncSecret(PLAINTEXT, key, AAD))).toBe('invalid_key');
  });

  it('refuses to seal with an all-zero shared secret', () => {
    const { publicKey } = getSyncPublicKey();
    ctx.zeroSharedSecret = true;
    try {
      expect(sealError(() => sealSyncSecret(PLAINTEXT, publicKey, AAD))).toBe('invalid_key');
    } finally {
      ctx.zeroSharedSecret = false;
    }
  });

  it('keeps values and keys out of error messages', () => {
    const sealed = sealSyncSecret(PLAINTEXT, getSyncPublicKey().publicKey, AAD);
    useSecret(OTHER_SECRET);
    const error = (() => {
      try {
        openSyncSecret(sealed, AAD);
      } catch (caught) {
        return caught as Error;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(SyncSealError);
    const text = `${error!.message} ${String(error!.stack)}`;
    expect(text).not.toContain(sealed.slice(SEALED_SYNC_SECRET_PREFIX.length, 40));
    expect(text).not.toContain(PLAINTEXT);
    expect(error!.cause).toBeUndefined();
  });
});

describe('sync nonces', () => {
  it('are accepted once each', () => {
    const first = issueSyncNonce();
    const second = issueSyncNonce();

    expect(first).toMatch(NONCE_PATTERN);
    expect(second).not.toBe(first);
    expect(consumeSyncNonce(second)).toBe(true);
    expect(consumeSyncNonce(second)).toBe(false);
    expect(consumeSyncNonce(first)).toBe(true);
    expect(consumeSyncNonce(first)).toBe(false);
  });

  it('are not accepted when this process did not issue them', () => {
    expect(consumeSyncNonce('AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(consumeSyncNonce('')).toBe(false);
  });

  it('expire after ten minutes', () => {
    vi.useFakeTimers();
    const kept = issueSyncNonce();
    const expired = issueSyncNonce();

    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(consumeSyncNonce(kept)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(consumeSyncNonce(expired)).toBe(false);
  });

  it('stay usable for the newest 100 only', () => {
    const oldest = issueSyncNonce();
    const next = issueSyncNonce();
    const newer = Array.from({ length: 98 }, () => issueSyncNonce());

    expect(consumeSyncNonce(oldest)).toBe(true);
    // Using one up makes room; issuing past the limit drops the oldest.
    issueSyncNonce();
    issueSyncNonce();
    expect(consumeSyncNonce(next)).toBe(false);
    expect(newer.every((nonce) => consumeSyncNonce(nonce))).toBe(true);
  });
});

describe('parseSyncPublicKeyResponse', () => {
  it('accepts a slave key response', () => {
    const response = createSyncKeyResponse();

    expect(parseSyncPublicKeyResponse(JSON.parse(JSON.stringify(response))))
      .toEqual({ ...getSyncPublicKey(), nonce: response.nonce });
  });

  const valid = () => createSyncKeyResponse() as unknown as Record<string, unknown>;

  it.each([
    ['null', () => null],
    ['a string', () => 'key'],
    ['an { ok: true } reply', () => ({ ok: true })],
    ['another version', () => ({ ...valid(), version: 2 })],
    ['another algorithm', () => ({ ...valid(), algorithm: 'x25519-hkdf-sha256-chacha20poly1305' })],
    ['a short key', () => ({ ...valid(), publicKey: Buffer.alloc(31, 1).toString('base64') })],
    ['a key that is not base64', () => ({ ...valid(), publicKey: `${'-'.repeat(43)}=` })],
    ['a key id that does not match the key', () => ({ ...valid(), keyId: '0000000000000000' })],
    ['no key id', () => ({ ...valid(), keyId: undefined })],
    ['no nonce', () => ({ ...valid(), nonce: undefined })],
    ['a short nonce', () => ({ ...valid(), nonce: 'A'.repeat(21) })],
    ['a nonce that is not base64url', () => ({ ...valid(), nonce: `${'A'.repeat(21)}+` })],
  ])('rejects %s', (_case, body) => {
    expect(parseSyncPublicKeyResponse(body())).toBeNull();
  });
});
