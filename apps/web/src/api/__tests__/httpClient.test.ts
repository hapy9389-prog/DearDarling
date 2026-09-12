import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../httpClient';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest — 상태 코드별 해석', () => {
  it('2xx는 ok로, 본문을 그대로 담는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));
    const result = await apiRequest('/api/auth/signup');
    expect(result).toEqual({ kind: 'ok', data: { ok: true }, status: 200 });
  });

  it('204(본문 없음)도 ok — data는 undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const result = await apiRequest('/api/auth/logout');
    expect(result).toEqual({ kind: 'ok', data: undefined, status: 204 });
  });

  it('401은 성공이 아니라 rejected — 상태와 에러 코드를 그대로 전달', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid-credentials' })),
    );
    const result = await apiRequest('/api/auth/login');
    expect(result).toEqual({ kind: 'rejected', status: 401, error: 'invalid-credentials', message: undefined });
  });

  it('429는 rate-limited로 분리한다(성공·실패 어느 쪽도 아님)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate-limited' })));
    const result = await apiRequest('/api/auth/login');
    expect(result).toEqual({ kind: 'rate-limited' });
  });

  it('202(결과 불명)를 성공으로 단정하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(202, { status: 'unknown', message: '확인 중' })),
    );
    const result = await apiRequest('/api/auth/confirm-signup');
    expect(result.kind).toBe('unknown');
    expect(result).toMatchObject({ status: 202, message: '확인 중' });
  });

  it('503(auth-unavailable)도 unknown으로 다룬다 — invalid-credentials로 단정하지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(503, { error: 'auth-unavailable', message: '재시도' })),
    );
    const result = await apiRequest('/api/auth/login');
    expect(result).toMatchObject({ kind: 'unknown', status: 503, message: '재시도' });
  });

  it('fetch 자체가 실패하면(네트워크 오류) network-error — rejected와 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const result = await apiRequest('/api/auth/me');
    expect(result).toEqual({ kind: 'network-error' });
  });

  it('본문이 JSON이 아니어도 죽지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    const result = await apiRequest('/api/auth/me');
    expect(result.kind).toBe('ok');
  });
});
