/**
 * apps/web/src/mocks/domain/auth.ts의 형식 검증 규칙을 이식한다. 실제 인증(Cognito)이
 * 아직 연결되지 않은 이번 단계에서도 프로필 저장 등에 재사용한다 — 비밀번호 자체는
 * 이 서버가 저장하지 않는다(향후 Cognito 연동 시에도 서버를 거쳐 전달만 하고 저장하지 않을 예정).
 */

export interface FieldCheck {
  ok: boolean;
  message?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: string): FieldCheck {
  const value = raw.trim();
  if (!value) return { ok: false, message: '이메일을 입력해 주세요.' };
  if (!EMAIL_RE.test(value)) return { ok: false, message: '이메일 형식이 올바르지 않아요.' };
  return { ok: true };
}

/** 8-64자, 공백 없음, 영문 1자 이상 + 숫자 1자 이상. */
export function validatePassword(value: string): FieldCheck {
  if (!value) return { ok: false, message: '비밀번호를 입력해 주세요.' };
  if (value.length < 8 || value.length > 64) {
    return { ok: false, message: '비밀번호는 8자 이상 64자 이하로 입력해 주세요.' };
  }
  if (/\s/.test(value)) return { ok: false, message: '비밀번호에는 공백을 넣을 수 없어요.' };
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, message: '영문과 숫자를 각각 1자 이상 넣어 주세요.' };
  }
  return { ok: true };
}

export function profileComplete(nickname: string): boolean {
  return nickname.trim().length > 0;
}
