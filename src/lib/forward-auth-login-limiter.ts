import { createHash } from "node:crypto";
import { ipRateLimitBucket } from "@/src/lib/client-ip";
import { createRateLimiter, LOGIN_RATE_LIMIT, type RateLimiter } from "@/src/lib/rate-limit";

/**
 * The window the account ceiling is counted over: at least an hour, so
 * clients that each stay under the per-client limits cannot get a fresh
 * account budget every LOGIN_WINDOW_MS.
 */
export const ACCOUNT_FAILURE_WINDOW_MS = Math.max(LOGIN_RATE_LIMIT.windowMs, 60 * 60 * 1000);

/**
 * Failed portal logins against one account, from all clients combined within
 * ACCOUNT_FAILURE_WINDOW_MS, that block the account for LOGIN_BLOCK_MS. At
 * least 10 x LOGIN_MAX_ATTEMPTS, so a third party cannot lock a user out with
 * a handful of guesses, and out of reach of any single client: the per-client
 * limits give a client at most LOGIN_MAX_ATTEMPTS failures per
 * min(LOGIN_WINDOW_MS, LOGIN_BLOCK_MS), and one account window overlaps at
 * most ceil(ACCOUNT_FAILURE_WINDOW_MS / that) + 1 such periods, the first one
 * only partly. With the defaults that is 65 failures per hour.
 */
export const ACCOUNT_FAILURE_CEILING = Math.max(
  LOGIN_RATE_LIMIT.maxAttempts * 10,
  LOGIN_RATE_LIMIT.maxAttempts *
    (Math.ceil(ACCOUNT_FAILURE_WINDOW_MS / Math.min(LOGIN_RATE_LIMIT.windowMs, LOGIN_RATE_LIMIT.blockMs)) + 1)
);

// Separate from the shared limiter so portal keys, which unauthenticated
// clients choose, never evict entries of the dashboard credential routes.
const perClient = createRateLimiter(LOGIN_RATE_LIMIT);
const perAccount = createRateLimiter({
  ...LOGIN_RATE_LIMIT,
  maxAttempts: ACCOUNT_FAILURE_CEILING,
  windowMs: ACCOUNT_FAILURE_WINDOW_MS,
});

/**
 * Limiter keys for a login attempt. The username is hashed, so every key has
 * a fixed size whatever the client sends. `ip` comes from getClientIp and is
 * already a short, validated value; IPv6 clients are keyed by their /64.
 */
export function portalLoginKeys(username: string, ip: string) {
  const account = createHash("sha256").update(username.toLowerCase(), "utf8").digest("base64url");
  const client = ipRateLimitBucket(ip);
  return {
    /** Failures from one client across all accounts. */
    ip: `ip:${client}`,
    /** Failures from one client against one account. */
    accountIp: `account-ip:${account}:${client}`,
    /** Failures against one account from all clients (checked against the ceiling). */
    account: `account:${account}`,
  };
}

/** A login attempt admitted by beginPortalLoginAttempt; the first call to any method ends it. */
export type PortalLoginAttempt = {
  /** Counts a failed login against the client, the (account, client) pair and the account. */
  fail(): void;
  /**
   * Clears the client's own counters. The account counter is left to expire:
   * it holds failures from other clients, and clearing it would give a
   * distributed guessing run a fresh budget each time the user logs in. The
   * per-(account, client) counter is what still limits a client that clears
   * its IP counter by signing in to an account of its own.
   */
  succeed(): void;
  /** Ends the attempt without counting it, e.g. when checking it threw. */
  release(): void;
};

/**
 * Admits a login attempt, or returns null when any limit is reached. Attempts
 * still being checked count towards every limit, so a burst of concurrent
 * requests gets no more guesses than the same requests sent one by one.
 */
export function beginPortalLoginAttempt(username: string, ip: string): PortalLoginAttempt | null {
  const keys = portalLoginKeys(username, ip);
  const slots: Array<[RateLimiter, string]> = [
    [perClient, keys.ip],
    [perClient, keys.accountIp],
    [perAccount, keys.account],
  ];
  const releases: Array<() => void> = [];
  for (const [limiter, key] of slots) {
    const release = limiter.reserveAttempt(key);
    if (!release) {
      releases.forEach((held) => held());
      return null;
    }
    releases.push(release);
  }

  let ended = false;
  const end = (record: () => void) => {
    if (ended) return;
    ended = true;
    releases.forEach((held) => held());
    record();
  };
  return {
    fail: () =>
      end(() => {
        for (const [limiter, key] of slots) limiter.registerAttempt(key);
      }),
    succeed: () =>
      end(() => {
        perClient.resetAttempts(keys.ip);
        perClient.resetAttempts(keys.accountIp);
      }),
    release: () => end(() => {}),
  };
}
