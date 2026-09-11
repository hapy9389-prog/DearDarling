import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Pool } from 'pg';
import { resetTables, getTestPool } from '../helpers/db';
import {
  buildTestAppWithAuth,
  TEST_ALLOWED_ORIGIN,
  TEST_TOKEN_ENCRYPTION_KEY,
} from '../helpers/app';
import { createApp } from '../../src/app';
import { createStubAuthPort } from '../../src/cognito/stubAuthPort';
import { createUser } from '../../src/repositories/usersRepository';
import { requestIdMiddleware } from '../../src/middleware/requestId';
import { errorHandler } from '../../src/middleware/errorHandler';

/**
 * 요청 로깅 미들웨어가 없는 것 자체가 비밀번호·코드를 안 남기는 1차 방어다(app.ts 참고) — 이
 * 테스트는 "만약 뭔가 콘솔에 찍힌다면 최소한 비밀번호·코드 원문은 아니어야 한다"는 걸
 * 로그인 실패·재설정 실패 경로에서 실제로 console 출력을 가로채 확인한다.
 */
describe('auth routes never write secrets to the console', () => {
  const SECRET_PASSWORD = 'SuperSecretPassw0rd!';
  const SECRET_CODE = '999999';
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetTables();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function assertNoSecretLogged() {
    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const text = call
          .map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ');
        expect(text).not.toContain(SECRET_PASSWORD);
        expect(text).not.toContain(SECRET_CODE);
      }
    }
  }

  it('does not log the password on a failed login', async () => {
    const { app } = await buildTestAppWithAuth();
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email: 'nobody@example.com', password: SECRET_PASSWORD });
    assertNoSecretLogged();
  });

  it('does not log the reset code or new password on a failed confirm-forgot-password', async () => {
    const { app } = await buildTestAppWithAuth();
    await request(app)
      .post('/api/auth/confirm-forgot-password')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email: 'nobody@example.com', code: SECRET_CODE, newPassword: SECRET_PASSWORD });
    assertNoSecretLogged();
  });

  const SECRET_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.synthetic-token-value';
  const SECRET_COOKIE = 'dd_session=leak-if-serialized';
  const SECRET_STACK_MARKER = 'STACK_SECRET_MARKER_a1b2c3';
  const SECRET_MESSAGE_MARKER = 'MESSAGE_SECRET_MARKER_d4e5f6';
  const SECRET_STRING_THROW_MARKER = 'STRING_THROW_SECRET_MARKER_g7h8i9';
  const SECRET_BODY_MARKER = 'BODY_PARSE_SECRET_MARKER_j0k1l2';

  function assertNoneOfTheseSecretsLogged(secrets: string[]) {
    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const text = call
          .map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ');
        for (const secret of secrets) expect(text).not.toContain(secret);
      }
    }
  }

  /** errorHandler가 console.error('[errorHandler]', payload)로 남긴 마지막 payload를 꺼낸다. */
  function lastErrorHandlerPayload(): { route?: string } | undefined {
    const call = [...errorSpy.mock.calls].reverse().find((c) => c[0] === '[errorHandler]');
    return call?.[1] as { route?: string } | undefined;
  }

  /** profile 라우트가 쓰는 SELECT 쿼리 하나만 겨냥해, 그 자리에서 던져지는 값을 makeErr로 바꿔치기한다. */
  function buildAppWithProfileQueryFailure(pool: Pool, makeErr: () => unknown) {
    const failingPool = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop === 'query') {
          return (...args: unknown[]) => {
            const text =
              typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text;
            if (text?.includes('SELECT * FROM users WHERE id')) {
              return Promise.reject(makeErr());
            }
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Pool;

    return createApp({
      pool: failingPool,
      localTestAuth: true,
      allowedOrigin: TEST_ALLOWED_ORIGIN,
      authPort: createStubAuthPort(),
      tokenEncryptionKey: TEST_TOKEN_ENCRYPTION_KEY,
    });
  }

  it('errorHandler never dumps a whole error object — password/code/cookie/token as extra fields stay out of the logs on a real 500 path', async () => {
    const pool = await getTestPool();
    const user = await createUser(pool, 'errpath-fields@example.com');

    const app = buildAppWithProfileQueryFailure(pool, () =>
      Object.assign(new Error('boom'), {
        password: SECRET_PASSWORD,
        code: SECRET_CODE,
        cookie: SECRET_COOKIE,
        token: SECRET_TOKEN,
      }),
    );

    await request(app).get('/api/profile').set('X-Test-User-Id', user.id).expect(500);

    assertNoneOfTheseSecretsLogged([SECRET_PASSWORD, SECRET_CODE, SECRET_COOKIE, SECRET_TOKEN]);
  });

  it('errorHandler never logs err.message or err.stack, even when a secret is embedded in them', async () => {
    const pool = await getTestPool();
    const user = await createUser(pool, 'errpath-message@example.com');

    const app = buildAppWithProfileQueryFailure(pool, () => {
      const err = new Error(`query failed for password=${SECRET_MESSAGE_MARKER}`);
      err.stack = `Error: query failed\n    at somewhere (${SECRET_STACK_MARKER}:1:1)`;
      return err;
    });

    await request(app).get('/api/profile').set('X-Test-User-Id', user.id).expect(500);

    assertNoneOfTheseSecretsLogged([SECRET_MESSAGE_MARKER, SECRET_STACK_MARKER]);
  });

  it('errorHandler never logs a spoofed err.name either — instanceof/SQLSTATE only, name is not trusted', async () => {
    const pool = await getTestPool();
    const user = await createUser(pool, 'errpath-name@example.com');

    const app = buildAppWithProfileQueryFailure(pool, () => {
      const err = new Error('boom');
      err.name = `SpoofedException:${SECRET_MESSAGE_MARKER}`; // 임의로 설정 가능한 필드다
      return err;
    });

    await request(app).get('/api/profile').set('X-Test-User-Id', user.id).expect(500);

    assertNoneOfTheseSecretsLogged([SECRET_MESSAGE_MARKER]);
  });

  it('errorHandler never logs a thrown non-Error value (e.g. a rejected string) either', async () => {
    const pool = await getTestPool();
    const user = await createUser(pool, 'errpath-string-throw@example.com');

    const app = buildAppWithProfileQueryFailure(
      pool,
      () => `plain string rejection containing ${SECRET_STRING_THROW_MARKER}`,
    );

    await request(app).get('/api/profile').set('X-Test-User-Id', user.id).expect(500);

    assertNoneOfTheseSecretsLogged([SECRET_STRING_THROW_MARKER]);
  });

  it('a malformed JSON request body never leaks its content through the body-parser SyntaxError, and is logged with route="unmatched"', async () => {
    const { app } = await buildTestAppWithAuth();
    // 닫는 중괄호가 없는 잘못된 JSON — 그 안에 비밀값을 넣어 둔다(실제 비밀정보 아님, 합성 값).
    const malformedJson = `{"email":"a@example.com","password":"${SECRET_BODY_MARKER}"`;

    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(malformedJson)
      .expect(500); // express.json()의 파싱 오류가 errorHandler까지 실제로 도달하는지도 함께 확인

    assertNoneOfTheseSecretsLogged([SECRET_BODY_MARKER]);
    // 라우팅이 아직 안 끝난 상태에서 난 오류이므로 고정값 'unmatched'로 남아야 한다.
    expect(lastErrorHandlerPayload()?.route).toBe('unmatched');
  });

  it('a secret placed in the actual URL path (a route param) never appears in the log — only the fixed route pattern does', async () => {
    // 실제 apps/api 라우터 전체(DB 포함)를 거칠 필요 없이, requestIdMiddleware→errorHandler라는
    // 실제 파이프라인 자체를 파라미터가 있는 라우트로 그대로 태운다 — Express가 실제로 채우는
    // req.route.path(패턴)와 req.baseUrl을 진짜로 검증하기 위해서다.
    const testApp = express();
    testApp.use(requestIdMiddleware);
    testApp.get('/api/test-only/:secret/action', (_req, _res, next) => {
      next(new Error('boom'));
    });
    testApp.use(errorHandler);

    const SECRET_IN_PATH = 'URL_PATH_SECRET_MARKER_m3n4o5';
    await request(testApp).get(`/api/test-only/${SECRET_IN_PATH}/action`).expect(500);

    assertNoneOfTheseSecretsLogged([SECRET_IN_PATH]);
    // req.path/req.originalUrl(실제 요청 URL) 대신 라우트 정의의 패턴만 남는다 — 실제 :secret 값이 아니다.
    expect(lastErrorHandlerPayload()?.route).toBe('/api/test-only/:secret/action');
  });
});
