/**
 * Usernames CPM gives accounts must be ones the login page accepts and can
 * find: they pass isValidLoginUsername and are lowercase, because Better Auth
 * lowercases what is typed before looking it up.
 */
import { describe, expect, it } from 'vitest';
import {
  LOGIN_USERNAME_MAX_LENGTH,
  isUsableSignInUsername,
  isValidLoginUsername,
  loginUsernameCandidates,
} from '@/src/lib/login-username';

function firstCandidates(email: string, count: number): string[] {
  const out: string[] = [];
  for (const candidate of loginUsernameCandidates(email)) {
    out.push(candidate);
    if (out.length === count) break;
  }
  return out;
}

describe('loginUsernameCandidates', () => {
  it('starts with the lowercase email when the login page accepts it', () => {
    expect(firstCandidates('  Alice.Smith@Example.com ', 3)).toEqual([
      'alice.smith@example.com',
      'alice.smith-2@example.com',
      'alice.smith-3@example.com',
    ]);
  });

  it('replaces the characters of a plus-addressed email the login page refuses', () => {
    expect(isValidLoginUsername('alice+cpm@example.com')).toBe(false);
    expect(firstCandidates('alice+cpm@example.com', 2)).toEqual([
      'alice-cpm@example.com',
      'alice-cpm-2@example.com',
    ]);
  });

  it('collapses runs of replaced characters', () => {
    expect(firstCandidates('+a++ --b"c@example.com+', 1)).toEqual(['-a-b-c@example.com-']);
    expect(firstCandidates('jöhn@exämple.com', 1)).toEqual(['j-hn@ex-mple.com']);
  });

  it('never turns an email into another plain address', () => {
    // Dropping the refused character, or folding a look-alike to ASCII, would
    // give alice@example.com or kate@example.com, other people's addresses.
    expect(firstCandidates('+alice@example.com', 1)).toEqual(['-alice@example.com']);
    expect(firstCandidates('alice@example.com+', 1)).toEqual(['alice@example.com-']);
    expect(firstCandidates('ålice@example.com', 1)).toEqual(['-lice@example.com']);
    expect(firstCandidates('\u212Aate@example.com', 1)).toEqual(['-ate@example.com']);
    expect(firstCandidates('\u212AATE@EXAMPLE.COM', 1)).toEqual(['-ate@example.com']);
  });

  it('falls back to "user" when too little of the email is left', () => {
    expect(firstCandidates('+@', 2)).toEqual(['user', 'user-2']);
    expect(firstCandidates('ü@x', 1)).toEqual(['-@x']);
  });

  it('numbers after the last @', () => {
    expect(firstCandidates('"a@b"+x@example.com', 2)).toEqual(['-a@b-x@example.com', '-a@b-x-2@example.com']);
  });

  it('keeps long emails within the length limit', () => {
    const email = `${'a'.repeat(200)}+tag@${'d'.repeat(80)}.example.com`;
    const candidates = firstCandidates(email, 12);
    expect(candidates).toHaveLength(12);
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(LOGIN_USERNAME_MAX_LENGTH);
      expect(candidate.endsWith(`@${'d'.repeat(80)}.example.com`)).toBe(true);
    }
    expect(candidates[11]).toMatch(/-12@/);
  });

  it('only offers distinct usernames the login page can find', () => {
    for (const email of ['bob@example.com', 'Bob+Tag@Example.com', 'x@y', '+@', `${'z'.repeat(300)}@example.com`]) {
      const candidates = [...loginUsernameCandidates(email)];
      expect(candidates.length).toBeGreaterThan(1);
      expect(new Set(candidates).size).toBe(candidates.length);
      for (const candidate of candidates) {
        expect(isUsableSignInUsername(candidate)).toBe(true);
      }
    }
  });
});

describe('isUsableSignInUsername', () => {
  it('accepts a lowercase valid username only', () => {
    expect(isUsableSignInUsername('alice@example.com')).toBe(true);
    expect(isUsableSignInUsername('Alice')).toBe(false);
    expect(isUsableSignInUsername('alice+cpm@example.com')).toBe(false);
    expect(isUsableSignInUsername('ab')).toBe(false);
    expect(isUsableSignInUsername('')).toBe(false);
    expect(isUsableSignInUsername(null)).toBe(false);
    expect(isUsableSignInUsername(undefined)).toBe(false);
  });
});
