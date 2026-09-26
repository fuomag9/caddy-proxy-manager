/**
 * Sealing of instance sync secrets to the receiving slave's X25519 key
 * (src/lib/sync-crypto.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes } from 'node:crypto';

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
  createSyncKeyChallenge,
  createSyncKeyResponse,
  decodeSyncPublicKey,
  getSyncPublicKey,
  issueSyncNonce,
  openSyncSecret,
  parseSyncKeyRotationProofs,
  parseSyncPublicKeyResponse,
  sealSyncSecret,
  verifySyncKeyRotationProof,
  type SyncKeyChallenge,
  type SyncKeyRotationProof,
  type SyncSealErrorCode,
} from '../../src/lib/sync-crypto';
import { DISALLOWED_SESSION_SECRETS } from '../../src/lib/config';

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
  ctx.config.previousSessionSecrets = [];
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

// Encodings of X25519 points of order 1, 2, 4 or 8, including non-canonical
// ones (at or above the field prime, or with the unused top bit set).
const LOW_ORDER_POINTS = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  '0000000000000000000000000000000000000000000000000000000000000080',
];

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

  it.each(LOW_ORDER_POINTS)('rejects the low-order key %s with its matching key id', (hex) => {
    const raw = Buffer.from(hex, 'hex');
    const keyId = createHash('sha256').update(raw).digest('hex').slice(0, 16);

    expect(parseSyncPublicKeyResponse({ ...valid(), publicKey: raw.toString('base64'), keyId })).toBeNull();
  });
});

describe('decodeSyncPublicKey', () => {
  it('decodes a usable key', () => {
    const { publicKey } = getSyncPublicKey();

    expect(decodeSyncPublicKey(publicKey.toString('base64'))).toEqual(publicKey);
  });

  it.each<[string, unknown]>([
    ['not a string', getSyncPublicKey().publicKey],
    ['short', Buffer.alloc(31, 1).toString('base64')],
    ['long', Buffer.alloc(33, 1).toString('base64')],
    ['base64url', getSyncPublicKey().publicKey.toString('base64url')],
    ['padded with whitespace', ` ${getSyncPublicKey().publicKey.toString('base64')}`],
    ...LOW_ORDER_POINTS.map((hex): [string, unknown] => [`the low-order point ${hex}`, Buffer.from(hex, 'hex').toString('base64')]),
  ])('refuses a key that is %s', (_case, value) => {
    expect(decodeSyncPublicKey(value)).toBeNull();
  });

  it('refuses a key whose shared secret comes out all-zero', () => {
    const encoded = getSyncPublicKey().publicKey.toString('base64');
    ctx.zeroSharedSecret = true;
    try {
      expect(decodeSyncPublicKey(encoded)).toBeNull();
    } finally {
      ctx.zeroSharedSecret = false;
    }
  });
});

describe('sync key rotation proofs', () => {
  const PREVIOUS_SECRET = 'previous-secret-for-sync-crypto-tests-2222222222';
  const PLACEHOLDER_SECRET = 'change-me-in-production';
  const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  /** The key pair the slave derives from `secret`, as sync-crypto.ts specifies. */
  function derivedKeyPair(secret: string) {
    const seed = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'cpm-instance-sync-x25519:v1', 32));
    const privateKey = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
    const publicKey = Buffer.from(spki.subarray(spki.length - 32));
    return { privateKey, publicKey, keyId: createHash('sha256').update(publicKey).digest('hex').slice(0, 16) };
  }

  /** A rotation proof by the key derived from `secret`, computed from the specification. */
  function specifiedProof(secret: string, challenge: Buffer, currentPublicKey: Buffer, nonce: string): SyncKeyRotationProof {
    const previous = derivedKeyPair(secret);
    const shared = diffieHellman({
      privateKey: previous.privateKey,
      publicKey: createPublicKey({
        key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), challenge]),
        format: 'der',
        type: 'spki',
      }),
    });
    const key = hkdfSync('sha256', shared, Buffer.concat([challenge, previous.publicKey]), 'cpm-instance-sync-key-rotation:v1', 32);
    return {
      keyId: previous.keyId,
      proof: createHmac('sha256', Buffer.from(key)).update(currentPublicKey).update(nonce, 'utf8').digest('base64url'),
    };
  }

  /** The slave's key reply to `challenge`, with PREVIOUS_SECRET in SESSION_SECRET_PREVIOUS. */
  function rotatedReply(challenge: SyncKeyChallenge) {
    ctx.config.previousSessionSecrets = [PREVIOUS_SECRET];
    const reply = JSON.parse(JSON.stringify(createSyncKeyResponse(challenge.value)));
    return { reply, presented: parseSyncPublicKeyResponse(reply)!, proofs: parseSyncKeyRotationProofs(reply) };
  }

  const previousKey = () => {
    const { publicKey, keyId } = derivedKeyPair(PREVIOUS_SECRET);
    return { publicKey, keyId };
  };

  it('challenges with a fresh X25519 public key, base64url', () => {
    const challenge = createSyncKeyChallenge();

    expect(challenge.value).toMatch(PROOF_PATTERN);
    expect(Buffer.from(challenge.value, 'base64url').equals(challenge.publicKey)).toBe(true);
    expect(challenge.privateKey.asymmetricKeyType).toBe('x25519');
    expect(createSyncKeyChallenge().value).not.toBe(challenge.value);
  });

  it('are sent only for a challenge, and only with SESSION_SECRET_PREVIOUS', () => {
    const { value } = createSyncKeyChallenge();
    expect(createSyncKeyResponse(value)).not.toHaveProperty('rotationProofs');

    ctx.config.previousSessionSecrets = [PREVIOUS_SECRET];
    expect(createSyncKeyResponse()).not.toHaveProperty('rotationProofs');
    expect(createSyncKeyResponse(null)).not.toHaveProperty('rotationProofs');
  });

  it('are computed as specified, one per previous key, over the current key and the nonce', () => {
    const challenge = createSyncKeyChallenge();
    const { reply } = rotatedReply(challenge);

    expect(reply.rotationProofs).toEqual([
      specifiedProof(PREVIOUS_SECRET, challenge.publicKey, getSyncPublicKey().publicKey, reply.nonce),
    ]);
    expect(reply.rotationProofs[0].proof).toMatch(PROOF_PATTERN);
    expect(JSON.stringify(reply)).not.toContain(PREVIOUS_SECRET);
  });

  it('leave out the current key, repeated keys and the public placeholder secrets, and number at most 8', () => {
    const extra = Array.from({ length: 10 }, (_, i) => `extra-previous-secret-for-sync-crypto-tests-${i}`);
    ctx.config.previousSessionSecrets = [
      SLAVE_SECRET, ...DISALLOWED_SESSION_SECRETS, PREVIOUS_SECRET, PREVIOUS_SECRET, ...extra,
    ];

    const proofs = createSyncKeyResponse(createSyncKeyChallenge().value).rotationProofs!;

    expect(proofs.map((proof) => proof.keyId)).toEqual(
      [PREVIOUS_SECRET, ...extra.slice(0, 7)].map((secret) => derivedKeyPair(secret).keyId)
    );
  });

  it('prove every comma-separated previous secret before the whole value, up to 8', () => {
    const secrets = Array.from({ length: 8 }, (_, i) => `comma-separated-previous-secret-for-sync-crypto-tests-${i}`);
    // As config.previousSessionSecrets reads SESSION_SECRET_PREVIOUS: the whole value first, then each entry.
    ctx.config.previousSessionSecrets = [secrets.join(','), ...secrets];

    const proofs = createSyncKeyResponse(createSyncKeyChallenge().value).rotationProofs!;

    expect(proofs.map((proof) => proof.keyId)).toEqual(secrets.map((secret) => derivedKeyPair(secret).keyId));

    // The whole value still gets a slot that is left, for a secret that contains a comma.
    ctx.config.previousSessionSecrets = ['with,comma', 'with', 'comma'];
    expect(createSyncKeyResponse(createSyncKeyChallenge().value).rotationProofs!.map((proof) => proof.keyId))
      .toEqual(['with', 'comma', 'with,comma'].map((secret) => derivedKeyPair(secret).keyId));
  });

  it('are never made with a key derived from a public placeholder secret', () => {
    ctx.config.previousSessionSecrets = [...DISALLOWED_SESSION_SECRETS];

    expect(createSyncKeyResponse(createSyncKeyChallenge().value)).not.toHaveProperty('rotationProofs');
  });

  it('verify for the pinned key, the challenge, the presented key and its nonce', () => {
    const challenge = createSyncKeyChallenge();
    const { presented, proofs } = rotatedReply(challenge);

    expect(verifySyncKeyRotationProof(challenge, previousKey(), presented, proofs)).toBe(true);
  });

  it.each<[string, (input: {
    challenge: SyncKeyChallenge;
    pinned: ReturnType<typeof previousKey>;
    presented: ReturnType<typeof parseSyncPublicKeyResponse> & object;
    proofs: SyncKeyRotationProof[];
  }) => void]>([
    ['another challenge (a replayed proof)', (input) => { input.challenge = createSyncKeyChallenge(); }],
    ['another presented key', (input) => { input.presented = { ...input.presented, ...derivedKeyPair(OTHER_SECRET), nonce: input.presented.nonce }; }],
    ['another nonce', (input) => { input.presented = { ...input.presented, nonce: issueSyncNonce() }; }],
    ['a random proof', (input) => { input.proofs = [{ keyId: input.pinned.keyId, proof: randomBytes(32).toString('base64url') }]; }],
    ['no proof for the pinned key', (input) => { input.proofs = input.proofs.map((proof) => ({ ...proof, keyId: '0123456789abcdef' })); }],
    ["another key's proof under the pinned key id", (input) => {
      input.proofs = [{
        ...specifiedProof(OTHER_SECRET, input.challenge.publicKey, input.presented.publicKey, input.presented.nonce),
        keyId: input.pinned.keyId,
      }];
    }],
    ['a pinned key id that is not the pinned key\'s', (input) => { input.pinned = { ...input.pinned, keyId: derivedKeyPair(OTHER_SECRET).keyId }; }],
  ])('do not verify with %s', (_case, change) => {
    const challenge = createSyncKeyChallenge();
    const { presented, proofs } = rotatedReply(challenge);
    const input = { challenge, pinned: previousKey(), presented, proofs };
    change(input);

    expect(verifySyncKeyRotationProof(input.challenge, input.pinned, input.presented, input.proofs)).toBe(false);
  });

  it('do not verify for a pinned key derived from a public placeholder secret, whose private key is public', () => {
    const challenge = createSyncKeyChallenge();
    const presented = { ...getSyncPublicKey(), nonce: issueSyncNonce() };
    const placeholder = derivedKeyPair(PLACEHOLDER_SECRET);
    const proof = specifiedProof(PLACEHOLDER_SECRET, challenge.publicKey, presented.publicKey, presented.nonce);

    expect(verifySyncKeyRotationProof(challenge, placeholder, presented, [proof])).toBe(false);
    // The same proof by a key that is not public verifies.
    const own = derivedKeyPair(PREVIOUS_SECRET);
    const ownProof = specifiedProof(PREVIOUS_SECRET, challenge.publicKey, presented.publicKey, presented.nonce);
    expect(verifySyncKeyRotationProof(challenge, own, presented, [ownProof])).toBe(true);
  });

  it.each([
    ['too short', 'A'.repeat(42)],
    ['too long', 'A'.repeat(44)],
    ['padded', `${'A'.repeat(42)}=`],
    ['not base64url', `${'A'.repeat(42)}+`],
    ['empty', ''],
  ])('refuse a challenge that is %s, with or without SESSION_SECRET_PREVIOUS', (_case, challenge) => {
    expect(sealError(() => createSyncKeyResponse(challenge))).toBe('invalid_challenge');
    ctx.config.previousSessionSecrets = [PREVIOUS_SECRET];
    expect(sealError(() => createSyncKeyResponse(challenge))).toBe('invalid_challenge');
  });

  it('refuse a low-order challenge when a proof uses it', () => {
    ctx.config.previousSessionSecrets = [PREVIOUS_SECRET];

    expect(sealError(() => createSyncKeyResponse(Buffer.alloc(32).toString('base64url')))).toBe('invalid_challenge');
    ctx.zeroSharedSecret = true;
    try {
      expect(sealError(() => createSyncKeyResponse(createSyncKeyChallenge().value))).toBe('invalid_challenge');
    } finally {
      ctx.zeroSharedSecret = false;
    }
  });

  it('refuse a challenge before issuing a nonce', () => {
    ctx.config.previousSessionSecrets = [PREVIOUS_SECRET];
    const oldest = issueSyncNonce();
    const newer = Array.from({ length: 99 }, () => issueSyncNonce());

    // A nonce issued here would push the oldest out (see "stay usable for the newest 100 only").
    expect(sealError(() => createSyncKeyResponse('A'.repeat(42)))).toBe('invalid_challenge');
    expect(sealError(() => createSyncKeyResponse(Buffer.alloc(32).toString('base64url')))).toBe('invalid_challenge');
    expect(consumeSyncNonce(oldest)).toBe(true);
    expect(newer.every((nonce) => consumeSyncNonce(nonce))).toBe(true);
  });

  it('never verify with an all-zero shared secret', () => {
    const challenge = createSyncKeyChallenge();
    const { presented, proofs } = rotatedReply(challenge);
    ctx.zeroSharedSecret = true;
    try {
      expect(verifySyncKeyRotationProof(challenge, previousKey(), presented, proofs)).toBe(false);
    } finally {
      ctx.zeroSharedSecret = false;
    }
  });
});

describe('parseSyncKeyRotationProofs', () => {
  const proof = { keyId: '0123456789abcdef', proof: 'A'.repeat(43) };

  it('keeps the well-formed proofs of a reply', () => {
    expect(parseSyncKeyRotationProofs({
      rotationProofs: [
        proof,
        { ...proof, keyId: '0123456789ABCDEF' },
        { ...proof, proof: 'A'.repeat(42) },
        { ...proof, proof: `${'A'.repeat(42)}+` },
        { keyId: proof.keyId },
        null,
        'proof',
        { ...proof, extra: 'dropped' },
      ],
    })).toEqual([proof, proof]);
  });

  it.each([
    ['no reply', null],
    ['a reply without proofs', { keyId: proof.keyId }],
    ['proofs that are not an array', { rotationProofs: { 0: proof } }],
    ['more than 8 proofs', { rotationProofs: Array.from({ length: 9 }, () => proof) }],
  ])('finds none in %s', (_case, body) => {
    expect(parseSyncKeyRotationProofs(body)).toEqual([]);
  });

  it('keeps up to 8 proofs', () => {
    expect(parseSyncKeyRotationProofs({ rotationProofs: Array.from({ length: 8 }, () => proof) })).toHaveLength(8);
  });
});
