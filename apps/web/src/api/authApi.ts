import { apiGet, apiPost, type Outcome } from './httpClient';

/**
 * 실제 계정(`kind: 'real'`) 인증 API. 엔드포인트별 응답 계약은
 * `apps/api/src/routes/auth.ts`을 그대로 따른다 — 여기서 코드를 바꾸지 않는다.
 */

export interface MeResponse {
  authenticated: boolean;
  userId?: string;
}

/** GET /api/auth/me — 항상 200이다. 네트워크 실패만 별도로 구분한다. */
export async function getSession(): Promise<{ ok: true; data: MeResponse } | { ok: false }> {
  const result = await apiGet<MeResponse>('/api/auth/me');
  if (result.kind === 'ok') return { ok: true, data: result.data };
  return { ok: false };
}

export function signUp(email: string, password: string): Promise<Outcome<{ ok: true }>> {
  return apiPost('/api/auth/signup', { email, password });
}

export function confirmSignUp(email: string, code: string): Promise<Outcome<{ ok: true }>> {
  return apiPost('/api/auth/confirm-signup', { email, code });
}

export function resendConfirmationCode(email: string): Promise<Outcome<{ ok: true }>> {
  return apiPost('/api/auth/resend-confirmation', { email });
}

export function logIn(email: string, password: string): Promise<Outcome<{ ok: true }>> {
  return apiPost('/api/auth/login', { email, password });
}

export function requestPasswordReset(email: string): Promise<Outcome<{ ok: true }>> {
  return apiPost('/api/auth/forgot-password', { email });
}

export interface ConfirmForgotPasswordResponse {
  status: string;
  message?: string;
}

export function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<Outcome<ConfirmForgotPasswordResponse>> {
  return apiPost('/api/auth/confirm-forgot-password', { email, code, newPassword });
}

export function logOut(): Promise<Outcome<undefined>> {
  return apiPost('/api/auth/logout', {});
}

export function logOutAll(): Promise<Outcome<undefined>> {
  return apiPost('/api/auth/logout-all', {});
}
