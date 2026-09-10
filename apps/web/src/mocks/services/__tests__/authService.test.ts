import { afterEach, describe, expect, it } from 'vitest';
import { createMockAuthService } from '../authService';
import { createMockSettingsService } from '../settingsService';
import { resetAllMockData } from '../../storage';

const auth = createMockAuthService();

afterEach(() => {
  resetAllMockData();
});

describe('authService — 가입', () => {
  it('이메일을 등록하고, 동의 설정을 꺼진 상태로 기록한다', async () => {
    const result = await auth.signUp({ email: 'a@a.com', password: 'test1234' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const settings = createMockSettingsService().getSettings(result.userId);
    expect(settings.analysisConsent).toBe(false);
  });

  it('중복 이메일은 거부', async () => {
    await auth.signUp({ email: 'a@a.com', password: 'test1234' });
    const again = await auth.signUp({ email: 'A@A.com', password: 'other123' });
    expect(again).toMatchObject({ ok: false, code: 'email-taken' });
  });

  it('비밀번호는 어떤 저장소 값에도 남지 않는다', async () => {
    await auth.signUp({ email: 'secret@a.com', password: 'zebra9pw' });
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)!;
      expect(window.localStorage.getItem(key) ?? '').not.toContain('zebra9pw');
    }
  });

  it('형식 오류는 필드 코드로 거부', async () => {
    expect(await auth.signUp({ email: 'nope', password: 'test1234' })).toMatchObject({
      ok: false,
      code: 'invalid-email',
    });
    expect(await auth.signUp({ email: 'ok@a.com', password: 'short' })).toMatchObject({
      ok: false,
      code: 'invalid-password',
    });
  });
});

describe('authService — 로그인 / 재설정', () => {
  it('등록된 이메일 + 형식 유효 비밀번호면 성공, 미등록이면 no-account', async () => {
    await auth.signUp({ email: 'a@a.com', password: 'test1234' });
    expect(await auth.logIn({ email: 'a@a.com', password: 'whatever9' })).toMatchObject({
      ok: true,
    });
    expect(await auth.logIn({ email: 'ghost@a.com', password: 'test1234' })).toMatchObject({
      ok: false,
      code: 'no-account',
    });
  });

  it('재설정은 등록/미등록 모두 같은 성공 안내(계정 존재를 노출하지 않음)', async () => {
    await auth.signUp({ email: 'a@a.com', password: 'test1234' });
    expect((await auth.requestPasswordReset({ email: 'a@a.com' })).ok).toBe(true);
    expect((await auth.requestPasswordReset({ email: 'ghost@a.com' })).ok).toBe(true);
  });
});
