type RateLimitEntry = {
  attempts: number;
  firstAttemptTimestamp: number;
  blockedUntil?: number;
};

export type RateLimitOutcome = {
  blocked: boolean;
  retryAfterMs?: number;
};

export type RateLimiterOptions = {
  /** Attempts within `windowMs` that trigger a block. */
  maxAttempts: number;
  windowMs: number;
  /**
   * How long a key stays blocked once it reaches `maxAttempts`, or "window"
   * to block it only until its current window ends (a fixed-window limit).
   */
  blockMs: number | "window";
  /** Upper bound on tracked keys; defaults to MAX_TRACKED_KEYS. */
  maxKeys?: number;
};

export type RateLimiter = {
  isRateLimited(key: string): RateLimitOutcome;
  /** Counts one attempt (a failed login, or any request for a request limit). */
  registerAttempt(key: string): RateLimitOutcome;
  resetAttempts(key: string): void;
  /**
   * Holds a place for an attempt whose outcome is not known yet, so that
   * concurrent attempts cannot all pass the check before any of them is
   * counted. Returns null when the key is blocked or its counted and held
   * attempts already reach `maxAttempts`. Otherwise returns a function that
   * gives the place back; call it once the attempt ends, whatever the outcome,
   * and register a failure separately.
   */
  reserveAttempt(key: string): (() => void) | null;
};

/** Thresholds for credential checks (portal login, password change, account linking). */
export const LOGIN_RATE_LIMIT = {
  maxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5),
  windowMs: Number(process.env.LOGIN_WINDOW_MS ?? 5 * 60 * 1000),
  blockMs: Number(process.env.LOGIN_BLOCK_MS ?? 15 * 60 * 1000),
} as const;

// Keys are partly client-chosen (IPs, usernames), so each table is bounded.
// Callers keep keys short (hashes, validated IPs), which bounds memory too.
export const MAX_TRACKED_KEYS = 10_000;

/**
 * An in-memory limiter with its own table. `maxAttempts` attempts within
 * `windowMs` block the key for `blockMs`.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { maxAttempts, windowMs, blockMs } = options;
  const maxKeys = options.maxKeys ?? MAX_TRACKED_KEYS;
  const attempts = new Map<string, RateLimitEntry>();
  // Attempts in progress per key. An entry lives only while its requests are
  // in flight and holds at most maxAttempts, so the map is bounded by the
  // number of concurrent requests.
  const reserved = new Map<string, number>();

  function getEntry(key: string, now: number): RateLimitEntry | undefined {
    const entry = attempts.get(key);
    if (!entry) {
      return undefined;
    }

    // Unblock if the penalty period has elapsed.
    if (entry.blockedUntil && entry.blockedUntil <= now) {
      attempts.delete(key);
      return undefined;
    }

    // Reset the window once the observation window expires.
    if (!entry.blockedUntil && entry.firstAttemptTimestamp + windowMs <= now) {
      attempts.delete(key);
      return undefined;
    }

    return entry;
  }

  /**
   * Make room for one more key: drop expired entries, then the oldest entries
   * that are not currently blocked, and only then the oldest blocked ones — so
   * flooding the table with fresh keys does not lift an active block.
   */
  function makeRoom(now: number): void {
    if (attempts.size < maxKeys) return;
    for (const key of [...attempts.keys()]) getEntry(key, now);
    // Map iteration follows insertion order, so the first keys are the oldest.
    for (const [key, entry] of attempts) {
      if (attempts.size < maxKeys) return;
      if (!entry.blockedUntil) attempts.delete(key);
    }
    for (const key of attempts.keys()) {
      if (attempts.size < maxKeys) return;
      attempts.delete(key);
    }
  }

  function isRateLimited(key: string): RateLimitOutcome {
    const now = Date.now();
    const entry = getEntry(key, now);
    if (!entry) {
      return { blocked: false };
    }

    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { blocked: true, retryAfterMs: entry.blockedUntil - now };
    }

    return { blocked: false };
  }

  function registerAttempt(key: string): RateLimitOutcome {
    const now = Date.now();
    let entry = getEntry(key, now);

    // getEntry drops elapsed blocks, so a remaining blockedUntil is active.
    if (entry?.blockedUntil) {
      return { blocked: true, retryAfterMs: entry.blockedUntil - now };
    }

    if (!entry) {
      makeRoom(now);
      entry = { attempts: 0, firstAttemptTimestamp: now };
      attempts.set(key, entry);
    }

    entry.attempts += 1;

    if (entry.attempts >= maxAttempts) {
      const blockedUntil = blockMs === "window" ? entry.firstAttemptTimestamp + windowMs : now + blockMs;
      entry.attempts = 0;
      entry.firstAttemptTimestamp = now;
      entry.blockedUntil = blockedUntil;
      return { blocked: true, retryAfterMs: blockedUntil - now };
    }

    return { blocked: false };
  }

  function resetAttempts(key: string): void {
    attempts.delete(key);
  }

  function reserveAttempt(key: string): (() => void) | null {
    const entry = getEntry(key, Date.now());
    const held = reserved.get(key) ?? 0;
    if (entry?.blockedUntil || (entry?.attempts ?? 0) + held >= maxAttempts) {
      return null;
    }
    reserved.set(key, held + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (reserved.get(key) ?? 1) - 1;
      if (remaining > 0) reserved.set(key, remaining);
      else reserved.delete(key);
    };
  }

  return { isRateLimited, registerAttempt, resetAttempts, reserveAttempt };
}

// Shared limiter for the dashboard credential routes; callers namespace keys.
const defaultLimiter = createRateLimiter(LOGIN_RATE_LIMIT);

export const isRateLimited = defaultLimiter.isRateLimited;
export const registerFailedAttempt = defaultLimiter.registerAttempt;
export const resetAttempts = defaultLimiter.resetAttempts;
