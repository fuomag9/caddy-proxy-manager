/**
 * Unit tests for the pure environment-variable-reading functions
 * exported by src/lib/instance-sync.ts.
 *
 * These functions have no DB or network dependency — they only read
 * from process.env and do simple parsing/validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getEnvSlaveInstances,
  getSyncIntervalMs,
  isHttpSyncAllowed,
  isInstanceModeFromEnv,
  isSyncTokenFromEnv,
} from '../../src/lib/instance-sync';

const KEYS = [
  'INSTANCE_SLAVES',
  'INSTANCE_SYNC_INTERVAL',
  'INSTANCE_SYNC_ALLOW_HTTP',
  'INSTANCE_MODE',
  'INSTANCE_SYNC_TOKEN',
] as const;

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

// ---------------------------------------------------------------------------
// getEnvSlaveInstances
// ---------------------------------------------------------------------------

describe('getEnvSlaveInstances', () => {
  it('returns empty array when env var is not set', () => {
    expect(getEnvSlaveInstances()).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    process.env.INSTANCE_SLAVES = '';
    expect(getEnvSlaveInstances()).toEqual([]);
  });

  it('parses a valid single slave entry', () => {
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: 'slave1', url: 'https://slave.example.com', token: 'secret123' },
    ]);
    const result = getEnvSlaveInstances();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'slave1',
      url: 'https://slave.example.com',
      token: 'secret123',
    });
  });

  it('parses multiple slave entries', () => {
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: 'slave1', url: 'https://slave1.example.com', token: 'tok1' },
      { name: 'slave2', url: 'https://slave2.example.com', token: 'tok2' },
    ]);
    expect(getEnvSlaveInstances()).toHaveLength(2);
  });

  it('returns empty array for non-array JSON', () => {
    process.env.INSTANCE_SLAVES = '{"name":"slave1"}'; // object, not array
    expect(getEnvSlaveInstances()).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    process.env.INSTANCE_SLAVES = '{bad json';
    expect(getEnvSlaveInstances()).toEqual([]);
  });

  it('filters out entries missing required fields', () => {
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: 'slave1', url: 'https://slave1.example.com', token: 'tok1' }, // valid
      { name: 'slave2', url: 'https://slave2.example.com' },                // missing token
      { name: 'slave3', token: 'tok3' },                                    // missing url
      { url: 'https://slave4.example.com', token: 'tok4' },                 // missing name
    ]);
    const result = getEnvSlaveInstances();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('slave1');
  });

  it('filters out entries with empty string fields', () => {
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: '', url: 'https://slave.example.com', token: 'tok' }, // empty name
    ]);
    expect(getEnvSlaveInstances()).toEqual([]);
  });

  it('filters out non-object entries', () => {
    process.env.INSTANCE_SLAVES = JSON.stringify([
      42,
      null,
      'string',
      { name: 'ok', url: 'https://ok.com', token: 'tok' },
    ]);
    const result = getEnvSlaveInstances();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// getSyncIntervalMs
// ---------------------------------------------------------------------------

describe('getSyncIntervalMs', () => {
  it('returns 0 when env var is not set (disabled)', () => {
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('converts seconds to milliseconds', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '60';
    expect(getSyncIntervalMs()).toBe(60_000);
  });

  it('enforces minimum of 30 seconds', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '10';
    expect(getSyncIntervalMs()).toBe(30_000); // clamped to 30s
  });

  it('exactly 30 seconds is allowed', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '30';
    expect(getSyncIntervalMs()).toBe(30_000);
  });

  it('returns 0 for "0"', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '0';
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('returns 0 for negative value', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '-60';
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    process.env.INSTANCE_SYNC_INTERVAL = 'abc';
    expect(getSyncIntervalMs()).toBe(0);
  });

  it('handles large interval correctly', () => {
    process.env.INSTANCE_SYNC_INTERVAL = '3600'; // 1 hour
    expect(getSyncIntervalMs()).toBe(3_600_000);
  });
});

// ---------------------------------------------------------------------------
// isHttpSyncAllowed
// ---------------------------------------------------------------------------

describe('isHttpSyncAllowed', () => {
  it('returns false when env var is not set', () => {
    expect(isHttpSyncAllowed()).toBe(false);
  });

  it('returns true for "true"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = 'true';
    expect(isHttpSyncAllowed()).toBe(true);
  });

  it('returns true for "1"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = '1';
    expect(isHttpSyncAllowed()).toBe(true);
  });

  it('returns false for "false"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = 'false';
    expect(isHttpSyncAllowed()).toBe(false);
  });

  it('returns false for "yes"', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = 'yes';
    expect(isHttpSyncAllowed()).toBe(false);
  });

  it('returns false for empty string', () => {
    process.env.INSTANCE_SYNC_ALLOW_HTTP = '';
    expect(isHttpSyncAllowed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInstanceModeFromEnv
// ---------------------------------------------------------------------------

describe('isInstanceModeFromEnv', () => {
  it('returns false when env var is not set', () => {
    expect(isInstanceModeFromEnv()).toBe(false);
  });

  it('returns true for "master"', () => {
    process.env.INSTANCE_MODE = 'master';
    expect(isInstanceModeFromEnv()).toBe(true);
  });

  it('returns true for "slave"', () => {
    process.env.INSTANCE_MODE = 'slave';
    expect(isInstanceModeFromEnv()).toBe(true);
  });

  it('returns true for "standalone"', () => {
    process.env.INSTANCE_MODE = 'standalone';
    expect(isInstanceModeFromEnv()).toBe(true);
  });

  it('returns false for invalid mode', () => {
    process.env.INSTANCE_MODE = 'invalid';
    expect(isInstanceModeFromEnv()).toBe(false);
  });

  it('returns false for empty string', () => {
    process.env.INSTANCE_MODE = '';
    expect(isInstanceModeFromEnv()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSyncTokenFromEnv
// ---------------------------------------------------------------------------

describe('isSyncTokenFromEnv', () => {
  it('returns false when env var is not set', () => {
    expect(isSyncTokenFromEnv()).toBe(false);
  });

  it('returns true when token is set to a non-empty string', () => {
    process.env.INSTANCE_SYNC_TOKEN = 'my-secret-token';
    expect(isSyncTokenFromEnv()).toBe(true);
  });

  it('returns false for empty string token', () => {
    process.env.INSTANCE_SYNC_TOKEN = '';
    expect(isSyncTokenFromEnv()).toBe(false);
  });

  it('returns true for any non-empty value', () => {
    process.env.INSTANCE_SYNC_TOKEN = '   '; // whitespace counts as non-empty
    expect(isSyncTokenFromEnv()).toBe(true);
  });
});
