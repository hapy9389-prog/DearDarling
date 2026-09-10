import { describe, expect, it } from 'vitest';
import { normalizeEmail, profileComplete, validateEmail, validatePassword } from '../auth';

describe('validateEmail', () => {
  it('형식이 맞으면 통과', () => {
    expect(validateEmail('a@b.com').ok).toBe(true);
    expect(validateEmail('  A@B.CO  ').ok).toBe(true);
  });
  it('빈 값·형식 오류는 메시지와 함께 거부', () => {
    expect(validateEmail('').ok).toBe(false);
    expect(validateEmail('nope').ok).toBe(false);
    expect(validateEmail('a@b').ok).toBe(false);
  });
});

describe('validatePassword — 8–64자, 공백 없음, 영문+숫자', () => {
  it('규칙을 만족하면 통과', () => {
    expect(validatePassword('test1234').ok).toBe(true);
  });
  it('7자는 거부, 8자는 통과', () => {
    expect(validatePassword('test123').ok).toBe(false);
    expect(validatePassword('test1234').ok).toBe(true);
  });
  it('공백이 있으면 거부', () => {
    expect(validatePassword('test 1234').ok).toBe(false);
  });
  it('숫자만 / 영문만이면 거부', () => {
    expect(validatePassword('12345678').ok).toBe(false);
    expect(validatePassword('abcdefgh').ok).toBe(false);
  });
  it('64자 초과는 거부', () => {
    expect(validatePassword('a1'.repeat(33)).ok).toBe(false);
  });
});

describe('normalizeEmail / profileComplete', () => {
  it('normalizeEmail은 trim + 소문자', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
  it('profileComplete는 닉네임 공백 제거 후 길이', () => {
    expect(profileComplete('')).toBe(false);
    expect(profileComplete('   ')).toBe(false);
    expect(profileComplete('가온')).toBe(true);
  });
});
