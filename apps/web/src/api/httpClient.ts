/**
 * apps/api(`/api/auth/*`, `/api/profile`)를 호출하는 공용 fetch 래퍼. 실제 계정(`kind: 'real'`)
 * 전용이다 — 가상 검토·체험(mock) 경로는 이 파일을 쓰지 않는다.
 *
 * - 쿠키 기반 세션이라 항상 `credentials: 'include'`를 쓴다. 서버 응답의 `Set-Cookie`는
 *   브라우저가 알아서 저장한다 — 여기서 쿠키 값을 읽거나 다루지 않는다.
 * - HTTP 상태를 끝단 코드별로 그대로 노출하지 않고, 호출부가 안전하게 분기할 수 있는 결과
 *   타입으로 정규화한다. **202(Cognito 응답을 못 받음)와 5xx의 "확인 불가" 응답은 성공이
 *   아니다** — `unknown`으로 분리해 호출부가 성공으로 오인하지 않게 한다.
 * - 네트워크 자체가 끊긴 경우(`fetch`가 던짐)도 별도 종류(`network-error`)로 분리한다 —
 *   서버가 명확히 거부한 것과 같은 취급을 하지 않는다(로그아웃/세션 만료로 단정 금지).
 */

export type Outcome<T> =
  | { kind: 'ok'; data: T; status: number }
  | { kind: 'rejected'; status: number; error: string; message?: string }
  | { kind: 'unknown'; status: number; message: string }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' };

async function safeJson(res: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * `path`는 `/api`로 시작하는 경로(예: `/api/auth/login`)를 그대로 준다 — Vite 개발 서버의
 * `server.proxy`가 같은 출처로 그대로 넘겨주므로 브라우저 기준으로는 동일 출처 요청이 된다.
 */
export async function apiRequest<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<Outcome<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    return { kind: 'network-error' };
  }

  if (res.status === 429) return { kind: 'rate-limited' };

  if (res.status === 202 || res.status === 503) {
    const body = await safeJson(res);
    const message =
      (typeof body?.message === 'string' && body.message) ||
      '요청 처리 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return { kind: 'unknown', status: res.status, message };
  }

  if (res.status === 204) {
    return { kind: 'ok', data: undefined as T, status: res.status };
  }

  const body = await safeJson(res);

  if (res.ok) {
    return { kind: 'ok', data: (body ?? {}) as T, status: res.status };
  }

  return {
    kind: 'rejected',
    status: res.status,
    error: (typeof body?.error === 'string' && body.error) || 'unknown-error',
    message: typeof body?.message === 'string' ? body.message : undefined,
  };
}

export function apiPost<T = unknown>(path: string, body: unknown): Promise<Outcome<T>> {
  return apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiGet<T = unknown>(path: string): Promise<Outcome<T>> {
  return apiRequest<T>(path, { method: 'GET' });
}

export function apiPatch<T = unknown>(path: string, body: unknown): Promise<Outcome<T>> {
  return apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}
