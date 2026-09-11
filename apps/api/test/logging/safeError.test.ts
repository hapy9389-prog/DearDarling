import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { classifyError, safeRouteLabel } from '../../src/logging/safeError';

describe('classifyError', () => {
  it('classifies SyntaxError as syntax-error (e.g. malformed JSON request bodies)', () => {
    expect(classifyError(new SyntaxError('unexpected token'))).toBe('syntax-error');
  });

  it.each(['23505', '40001', '40P01'])(
    'classifies an allow-listed Postgres SQLSTATE code %s as pg:<code>',
    (code) => {
      const err = Object.assign(new Error('db error'), { code });
      expect(classifyError(err)).toBe(`pg:${code}`);
    },
  );

  it('does not log a code that merely has the right shape but is not on the allow list', () => {
    // 'ABCDE'는 SQLSTATE와 형식(5자 영숫자)은 같지만 이 프로젝트가 실제로 아는 코드가 아니다 —
    // 형식만으로 신뢰하면 임의의(또는 합성된) 값이 그대로 로그에 찍힌다.
    expect(classifyError(Object.assign(new Error('x'), { code: 'ABCDE' }))).toBe('error');
    expect(classifyError(Object.assign(new Error('x'), { code: '00000' }))).toBe('error'); // 형식은 맞음
  });

  it('does not treat a non-SQLSTATE-shaped code as a Postgres error code', () => {
    expect(classifyError(Object.assign(new Error('x'), { code: 'NOT_A_CODE' }))).toBe('error');
    expect(classifyError(Object.assign(new Error('x'), { code: '999999' }))).toBe('error'); // 6자리
    expect(classifyError(Object.assign(new Error('x'), { code: 12345 }))).toBe('error'); // 숫자 타입
  });

  it('classifies a generic Error as "error"', () => {
    expect(classifyError(new Error('boom'))).toBe('error');
  });

  it('classifies a thrown non-Error value as "non-error-thrown"', () => {
    expect(classifyError('just a string')).toBe('non-error-thrown');
    expect(classifyError(42)).toBe('non-error-thrown');
    expect(classifyError(null)).toBe('non-error-thrown');
    expect(classifyError(undefined)).toBe('non-error-thrown');
  });

  it('a spoofed err.name never changes the classification — only instanceof/SQLSTATE matter', () => {
    const err = new Error('x');
    err.name = 'CodeMismatchException'; // 임의로 설정 가능한 문자열일 뿐 — instanceof가 아니다
    expect(classifyError(err)).toBe('error');
  });
});

describe('safeRouteLabel', () => {
  function fakeReq(baseUrl: string, routePath: string | undefined): Request {
    return { baseUrl, route: routePath === undefined ? undefined : { path: routePath } } as Request;
  }

  it('combines only the fixed mount path and route pattern, never the actual request path', () => {
    expect(safeRouteLabel(fakeReq('/api/invites', '/:code/accept'))).toBe(
      '/api/invites/:code/accept',
    );
  });

  it('returns "unmatched" when routing has not resolved yet (e.g. a body-parse error)', () => {
    expect(safeRouteLabel(fakeReq('', undefined))).toBe('unmatched');
  });

  it('never reflects a secret placed in the actual URL path, even if req.path/originalUrl would have', () => {
    // req.path·req.originalUrl은 애초에 들여다보지 않는다 — 라우트 패턴만 쓰므로, 그 라우트로
    // 실제로 어떤 값이 들어왔는지는 이 함수의 출력에 전혀 반영되지 않는다.
    const req = {
      baseUrl: '/api/invites',
      route: { path: '/:code/accept' },
      path: '/api/invites/SECRET_IN_URL_PATH/accept',
      originalUrl: '/api/invites/SECRET_IN_URL_PATH/accept',
    } as unknown as Request;
    expect(safeRouteLabel(req)).not.toContain('SECRET_IN_URL_PATH');
    expect(safeRouteLabel(req)).toBe('/api/invites/:code/accept');
  });
});
