import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Reset the module between tests so the in-memory Map is cleared
let registerFailedAttempt: typeof import('@/src/lib/rate-limit').registerFailedAttempt;
let isRateLimited: typeof import('@/src/lib/rate-limit').isRateLimited;
let resetAttempts: typeof import('@/src/lib/rate-limit').resetAttempts;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('@/src/lib/rate-limit');
  registerFailedAttempt = mod.registerFailedAttempt;
  isRateLimited = mod.isRateLimited;
  resetAttempts = mod.resetAttempts;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rate-limit', () => {
  const KEY = 'test-ip-1';

  it('first attempt is not blocked', () => {
    const result = registerFailedAttempt(KEY);
    expect(result.blocked).toBe(false);
  });

  it('4 failed attempts are not blocked (below threshold of 5)', () => {
    for (let i = 0; i < 4; i++) {
      const result = registerFailedAttempt(KEY);
      expect(result.blocked).toBe(false);
    }
  });

  it('5th failed attempt triggers block', () => {
    for (let i = 0; i < 4; i++) {
      registerFailedAttempt(KEY);
    }
    const result = registerFailedAttempt(KEY);
    expect(result.blocked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('isRateLimited returns blocked after 5 failures', () => {
    for (let i = 0; i < 5; i++) {
      registerFailedAttempt(KEY);
    }
    const result = isRateLimited(KEY);
    expect(result.blocked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('isRateLimited returns not blocked for unknown key', () => {
    const result = isRateLimited('unknown-key-xyz');
    expect(result.blocked).toBe(false);
  });

  it('blocked entry unblocks after blockedUntil passes', () => {
    // Trigger block
    for (let i = 0; i < 5; i++) {
      registerFailedAttempt(KEY);
    }

    // Mock Date.now to be far in the future (past block window)
    const future = Date.now() + 16 * 60 * 1000; // 16 minutes
    vi.spyOn(Date, 'now').mockReturnValue(future);

    const result = isRateLimited(KEY);
    expect(result.blocked).toBe(false);
  });

  it('window expires without max attempts resets attempts', () => {
    // Make a few attempts
    for (let i = 0; i < 3; i++) {
      registerFailedAttempt(KEY);
    }

    // Jump past the window (default 5 minutes)
    const future = Date.now() + 6 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(future);

    // Now should be treated as first attempt
    const result = registerFailedAttempt(KEY);
    expect(result.blocked).toBe(false);
  });

  it('resetAttempts immediately unblocks a key', () => {
    for (let i = 0; i < 5; i++) {
      registerFailedAttempt(KEY);
    }
    expect(isRateLimited(KEY).blocked).toBe(true);

    resetAttempts(KEY);
    expect(isRateLimited(KEY).blocked).toBe(false);
  });

  it('different keys do not interfere', () => {
    const KEY_A = 'ip-a';
    const KEY_B = 'ip-b';

    for (let i = 0; i < 5; i++) {
      registerFailedAttempt(KEY_A);
    }

    expect(isRateLimited(KEY_A).blocked).toBe(true);
    expect(isRateLimited(KEY_B).blocked).toBe(false);
  });
});

describe('rate-limit table bound', () => {
  it('stays bounded when flooded with unique keys and keeps active blocks', async () => {
    const { MAX_TRACKED_KEYS } = await import('@/src/lib/rate-limit');
    for (let i = 0; i < 5; i++) registerFailedAttempt('account:admin');
    expect(isRateLimited('account:admin').blocked).toBe(true);

    for (let i = 0; i < MAX_TRACKED_KEYS + 500; i++) registerFailedAttempt(`ip:flood-${i}`);

    // The blocked key survives the flood; the oldest unblocked keys were evicted.
    expect(isRateLimited('account:admin').blocked).toBe(true);
    registerFailedAttempt('ip:flood-0');
    registerFailedAttempt('ip:flood-0');
    registerFailedAttempt('ip:flood-0');
    registerFailedAttempt('ip:flood-0');
    // flood-0 was evicted earlier, so it restarted its count: 4 fresh attempts, not blocked.
    expect(isRateLimited('ip:flood-0').blocked).toBe(false);
  });
});

describe('createRateLimiter', () => {
  it('keeps a separate table per limiter', async () => {
    const { createRateLimiter } = await import('@/src/lib/rate-limit');
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000, blockMs: 60_000 });
    limiter.registerAttempt('shared-key');
    expect(limiter.registerAttempt('shared-key').blocked).toBe(true);
    expect(limiter.isRateLimited('shared-key').blocked).toBe(true);
    // The default limiter has not seen this key.
    expect(isRateLimited('shared-key').blocked).toBe(false);
  });

  it('blocks on the maxAttempts-th attempt, including a limit of one', async () => {
    const { createRateLimiter } = await import('@/src/lib/rate-limit');
    const once = createRateLimiter({ maxAttempts: 1, windowMs: 60_000, blockMs: 60_000 });
    expect(once.registerAttempt('k').blocked).toBe(true);
    expect(once.isRateLimited('k').blocked).toBe(true);
  });

  it('bounds its table by maxKeys and keeps active blocks', async () => {
    const { createRateLimiter } = await import('@/src/lib/rate-limit');
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000, blockMs: 60_000, maxKeys: 10 });
    limiter.registerAttempt('blocked');
    limiter.registerAttempt('blocked');
    for (let i = 0; i < 50; i++) limiter.registerAttempt(`flood-${i}`);
    expect(limiter.isRateLimited('blocked').blocked).toBe(true);
    // flood-0 was evicted, so one more attempt starts a fresh count.
    expect(limiter.registerAttempt('flood-0').blocked).toBe(false);
  });
});

describe('createRateLimiter reserveAttempt', () => {
  it('counts held attempts towards the limit until they are given back', async () => {
    const { createRateLimiter } = await import('@/src/lib/rate-limit');
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000, blockMs: 60_000 });
    limiter.registerAttempt('k');
    const first = limiter.reserveAttempt('k');
    const second = limiter.reserveAttempt('k');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // One failure plus two attempts in flight reach the limit of 3.
    expect(limiter.reserveAttempt('k')).toBeNull();
    // Holding a place is not a failure.
    expect(limiter.isRateLimited('k').blocked).toBe(false);

    first!();
    first!();
    const third = limiter.reserveAttempt('k');
    expect(third).not.toBeNull();
    expect(limiter.reserveAttempt('k')).toBeNull();
    second!();
    third!();
    expect(limiter.reserveAttempt('other')).not.toBeNull();
  });

  it('refuses a blocked key', async () => {
    const { createRateLimiter } = await import('@/src/lib/rate-limit');
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000, blockMs: 60_000 });
    limiter.registerAttempt('k');
    limiter.registerAttempt('k');
    expect(limiter.reserveAttempt('k')).toBeNull();
  });
});

describe('createRateLimiter with blockMs "window"', () => {
  it('refuses only until the current window ends', async () => {
    const { createRateLimiter } = await import('@/src/lib/rate-limit');
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000, blockMs: 'window' });
    const start = 1_000_000;
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(start);
    expect(limiter.registerAttempt('k').blocked).toBe(false);
    now.mockReturnValue(start + 20_000);
    expect(limiter.registerAttempt('k').blocked).toBe(false);
    now.mockReturnValue(start + 40_000);
    expect(limiter.registerAttempt('k')).toEqual({ blocked: true, retryAfterMs: 20_000 });

    now.mockReturnValue(start + 59_000);
    expect(limiter.isRateLimited('k')).toEqual({ blocked: true, retryAfterMs: 1_000 });
    now.mockReturnValue(start + 60_000);
    expect(limiter.isRateLimited('k').blocked).toBe(false);
    expect(limiter.registerAttempt('k').blocked).toBe(false);
  });
});
