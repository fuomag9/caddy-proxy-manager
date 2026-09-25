import { describe, expect, it } from 'vitest';
import { passwordPolicyErrors, passwordPolicyMessage, MAX_PASSWORD_LENGTH } from '@/src/lib/password-policy';

describe('password policy', () => {
  it('accepts a password meeting every requirement', () => {
    expect(passwordPolicyErrors('Correct-Horse-9')).toEqual([]);
    expect(passwordPolicyMessage('Correct-Horse-9')).toBeNull();
  });

  it.each([
    ['too short', 'Aa1!aaaa', /at least 12/],
    ['no uppercase', 'correct-horse-9', /uppercase and lowercase/],
    ['no lowercase', 'CORRECT-HORSE-9', /uppercase and lowercase/],
    ['no digit', 'Correct-Horse-X', /number/],
    ['no special character', 'CorrectHorse99', /special character/],
  ])('rejects a password with %s', (_name, password, reason) => {
    expect(passwordPolicyMessage(password)).toMatch(reason);
  });

  it('bounds the length', () => {
    expect(passwordPolicyMessage(`Aa1!${'x'.repeat(MAX_PASSWORD_LENGTH)}`)).toMatch(/at most/);
  });
});
