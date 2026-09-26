import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_RATE_LIMIT } from '@/src/lib/rate-limit';

type LimiterModule = typeof import('@/src/lib/forward-auth-login-limiter');
let limiter: LimiterModule;

beforeEach(async () => {
  // Fresh limiter tables for every test.
  vi.resetModules();
  limiter = await import('@/src/lib/forward-auth-login-limiter');
});

afterEach(() => {
  vi.useRealTimers();
});

function fail(username: string, ip: string) {
  const attempt = limiter.beginPortalLoginAttempt(username, ip);
  expect(attempt).not.toBeNull();
  attempt!.fail();
}

function isBlocked(username: string, ip: string): boolean {
  const attempt = limiter.beginPortalLoginAttempt(username, ip);
  attempt?.release();
  return attempt === null;
}

/**
 * One client's most failures against 'alice' within one account window: its
 * first per-client period starts just before the account window, and
 * `perPeriod` failures follow at the start of every later period until the
 * account window ends. Returns how many failures landed in the second window.
 */
function failFromOneClientAcrossAccountWindow(periodMs: number, perPeriod: number): number {
  const { maxAttempts } = LOGIN_RATE_LIMIT;
  const ip = '192.0.2.1';
  // Opens the first account window.
  fail('alice', ip);
  vi.advanceTimersByTime(limiter.ACCOUNT_FAILURE_WINDOW_MS - 1);
  // Opens a per-client window 1 ms before the account window ends...
  fail('alice', ip);
  vi.advanceTimersByTime(1);
  // ...and uses the rest of it, unblocked, in the next account window.
  let counted = 0;
  for (let i = 0; i < maxAttempts - 2; i++, counted++) fail('alice', ip);
  const accountWindowEnd = Date.now() + limiter.ACCOUNT_FAILURE_WINDOW_MS;
  for (let start = Date.now() - 1 + periodMs; start < accountWindowEnd; start += periodMs) {
    vi.setSystemTime(start);
    for (let i = 0; i < perPeriod; i++, counted++) fail('alice', ip);
  }
  return counted;
}

describe('portal login limiter keys', () => {
  it('have a fixed size whatever the username length', () => {
    const short = limiter.portalLoginKeys('a', '192.0.2.1');
    const huge = limiter.portalLoginKeys('a'.repeat(4 * 1024 * 1024), '192.0.2.1');
    expect(huge.account.length).toBe(short.account.length);
    expect(huge.accountIp.length).toBe(short.accountIp.length);
    expect(huge.account.length).toBeLessThan(64);
  });

  it('treat usernames case-insensitively', () => {
    expect(limiter.portalLoginKeys('Alice', '192.0.2.1')).toEqual(limiter.portalLoginKeys('alice', '192.0.2.1'));
  });

  it('key IPv6 clients by their /64 and IPv4 clients by address', () => {
    expect(limiter.portalLoginKeys('alice', '2001:db8:1:2::1')).toEqual(
      limiter.portalLoginKeys('alice', '2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    );
    expect(limiter.portalLoginKeys('alice', '2001:db8:1:2::1').ip).not.toBe(
      limiter.portalLoginKeys('alice', '2001:db8:1:3::1').ip
    );
    expect(limiter.portalLoginKeys('alice', '192.0.2.1').ip).not.toBe(
      limiter.portalLoginKeys('alice', '192.0.2.2').ip
    );
  });
});

describe('portal login limits', () => {
  it('blocks a client after 5 failures against one account without blocking the account elsewhere', () => {
    for (let i = 0; i < 5; i++) fail('alice', '192.0.2.1');
    expect(isBlocked('alice', '192.0.2.1')).toBe(true);
    expect(isBlocked('alice', '192.0.2.2')).toBe(false);
  });

  it('blocks a whole IPv6 /64 after 5 failures from different addresses in it', () => {
    for (let i = 1; i <= 5; i++) fail(`user-${i}`, `2001:db8:0:1::${i}`);
    expect(isBlocked('someone', '2001:db8:0:1:ffff::1')).toBe(true);
    expect(isBlocked('someone', '2001:db8:0:2::1')).toBe(false);
  });

  it('blocks an account at the ceiling of failures from all clients', () => {
    for (let i = 0; i < limiter.ACCOUNT_FAILURE_CEILING - 1; i++) {
      fail('alice', `10.0.${i >> 8}.${i & 255}`);
    }
    expect(isBlocked('alice', '192.0.2.9')).toBe(false);
    fail('alice', '10.1.0.0');
    expect(isBlocked('alice', '192.0.2.9')).toBe(true);
    expect(isBlocked('bob', '192.0.2.9')).toBe(false);
  });

  it('a sign-in clears the client counters but not the account ceiling', () => {
    for (let i = 0; i < 4; i++) fail('carol', '192.0.2.9');
    for (let i = 0; i < limiter.ACCOUNT_FAILURE_CEILING - 1; i++) {
      fail('alice', `10.0.${i >> 8}.${i & 255}`);
    }
    limiter.beginPortalLoginAttempt('alice', '192.0.2.9')!.succeed();
    // The client's IP counter was cleared: 4 more failures elsewhere do not block it.
    for (let i = 0; i < 4; i++) fail(`other-${i}`, '192.0.2.9');
    expect(isBlocked('dave', '192.0.2.9')).toBe(false);
    // The account counter was not.
    fail('alice', '10.1.0.0');
    expect(isBlocked('alice', '192.0.2.10')).toBe(true);
  });

  it('counts the account ceiling over an hour, not one per-client window', () => {
    vi.useFakeTimers();
    const perWindow = limiter.ACCOUNT_FAILURE_CEILING - 1;
    let admitted = 0;
    let refusedInWindow = -1;
    // New clients every LOGIN_WINDOW_MS, each far below the per-client limits.
    for (let window = 0; window < 12 && refusedInWindow < 0; window++) {
      for (let i = 0; i < perWindow; i++) {
        const attempt = limiter.beginPortalLoginAttempt('alice', `10.${window}.${i >> 8}.${i & 255}`);
        if (!attempt) {
          refusedInWindow = window;
          break;
        }
        attempt.fail();
        admitted++;
      }
      vi.advanceTimersByTime(LOGIN_RATE_LIMIT.windowMs);
    }
    expect(limiter.ACCOUNT_FAILURE_WINDOW_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(refusedInWindow).toBeGreaterThanOrEqual(0);
    expect(admitted).toBe(limiter.ACCOUNT_FAILURE_CEILING);
  });

  it('keeps an account blocked for LOGIN_BLOCK_MS once it reaches the ceiling', () => {
    vi.useFakeTimers();
    for (let i = 0; i < limiter.ACCOUNT_FAILURE_CEILING; i++) {
      fail('alice', `10.0.${i >> 8}.${i & 255}`);
    }
    vi.advanceTimersByTime(LOGIN_RATE_LIMIT.blockMs - 1);
    expect(isBlocked('alice', '192.0.2.9')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isBlocked('alice', '192.0.2.9')).toBe(false);
  });

  it('does not let one client reach the account ceiling by itself', () => {
    vi.useFakeTimers();
    const { maxAttempts, windowMs } = LOGIN_RATE_LIMIT;
    // maxAttempts - 1 per per-client window stays unblocked; the last window
    // can take one more, since the block it triggers no longer matters.
    const counted = failFromOneClientAcrossAccountWindow(windowMs, maxAttempts - 1);
    fail('alice', '192.0.2.1');
    expect(counted + 1).toBe((maxAttempts - 1) * (Math.ceil(limiter.ACCOUNT_FAILURE_WINDOW_MS / windowMs) + 1));
    expect(isBlocked('alice', '192.0.2.1')).toBe(true);
    expect(isBlocked('alice', '192.0.2.2')).toBe(false);
  });
});

describe('portal login limits with LOGIN_BLOCK_MS no longer than LOGIN_WINDOW_MS', () => {
  beforeEach(async () => {
    vi.stubEnv('LOGIN_BLOCK_MS', String(LOGIN_RATE_LIMIT.windowMs));
    vi.resetModules();
    limiter = await import('@/src/lib/forward-auth-login-limiter');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not let one client that gets blocked in every window reach the account ceiling', async () => {
    vi.useFakeTimers();
    const { LOGIN_RATE_LIMIT: limits } = await import('@/src/lib/rate-limit');
    expect(limits.blockMs).toBe(limits.windowMs);
    // Each block ends when the next per-client window would start, so the
    // client can take maxAttempts failures every period instead of one fewer.
    failFromOneClientAcrossAccountWindow(limits.blockMs, limits.maxAttempts);
    expect(isBlocked('alice', '192.0.2.2')).toBe(false);
  });
});

describe('portal login attempts in flight', () => {
  it('count towards the per-client limit until they end', () => {
    const held = Array.from({ length: 5 }, () => limiter.beginPortalLoginAttempt('alice', '192.0.2.1'));
    expect(held.every((attempt) => attempt !== null)).toBe(true);
    expect(limiter.beginPortalLoginAttempt('bob', '192.0.2.1')).toBeNull();

    // Ending one without counting it frees its place, and the refusal above held none.
    held[0]!.release();
    const next = limiter.beginPortalLoginAttempt('bob', '192.0.2.1');
    expect(next).not.toBeNull();
    next!.release();
    held.slice(1).forEach((attempt) => attempt!.release());
    for (let i = 0; i < 4; i++) fail('alice', '192.0.2.1');
    expect(isBlocked('alice', '192.0.2.1')).toBe(false);
  });

  it('count towards the account ceiling until they end', () => {
    const held = Array.from({ length: limiter.ACCOUNT_FAILURE_CEILING }, (_, i) =>
      limiter.beginPortalLoginAttempt('alice', `10.0.${i >> 8}.${i & 255}`)
    );
    expect(held.every((attempt) => attempt !== null)).toBe(true);
    expect(limiter.beginPortalLoginAttempt('alice', '192.0.2.9')).toBeNull();

    // The refused attempt gave back the places it took in the per-client limits.
    for (let i = 0; i < 4; i++) fail(`other-${i}`, '192.0.2.9');
    held.forEach((attempt) => attempt!.release());
    expect(isBlocked('bob', '192.0.2.9')).toBe(false);
  });

  it('are recorded once, by the first call that ends them', () => {
    for (let i = 0; i < 3; i++) fail('alice', '192.0.2.1');
    const attempt = limiter.beginPortalLoginAttempt('alice', '192.0.2.1')!;
    attempt.fail();
    attempt.fail();
    attempt.release();
    expect(isBlocked('alice', '192.0.2.1')).toBe(false);
  });
});
