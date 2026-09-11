import { describe, expect, it } from 'vitest';
import { validateEmail, validatePassword, profileComplete } from '../../src/domain/auth';

describe('auth domain', () => {
  it('rejects malformed emails', () => {
    expect(validateEmail('not-an-email').ok).toBe(false);
    expect(validateEmail('a@b.com').ok).toBe(true);
  });

  it('enforces password format rules', () => {
    expect(validatePassword('short1').ok).toBe(false);
    expect(validatePassword('nodigitshere').ok).toBe(false);
    expect(validatePassword('has space1').ok).toBe(false);
    expect(validatePassword('valid1password').ok).toBe(true);
  });

  it('treats a blank nickname as incomplete', () => {
    expect(profileComplete('  ')).toBe(false);
    expect(profileComplete('민준')).toBe(true);
  });
});
