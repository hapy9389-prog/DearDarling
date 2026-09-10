/**
 * 가입·로그인 입력 검증(0010). 화면 검토 단계의 가상 처리라 실제 인증은 하지 않는다 —
 * 형식만 확인하고, 비밀번호 값은 검증에만 쓰고 어디에도 저장·기록하지 않는다.
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

/** 8–64자, 공백 없음, 영문 1자 이상 + 숫자 1자 이상. */
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
