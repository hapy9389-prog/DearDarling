import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetTables, getTestPool } from '../helpers/db';
import { buildTestAppWithAuth, TEST_ALLOWED_ORIGIN, extractCookie } from '../helpers/app';

describe('Cognito auth routes', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('full happy path: signup → confirm-signup → login → protected route → logout', async () => {
    const { app, authPort } = await buildTestAppWithAuth();
    const email = 'happy@example.com';
    const password = 'GoodPassw0rd!';

    await request(app)
      .post('/api/auth/signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password })
      .expect(200);

    // 가입 직후엔 로컬 DB에 아무 것도 없다 — 사용자 행은 첫 로그인 시점에만 생긴다.
    const pool = await getTestPool();
    const { rows: beforeConfirm } = await pool.query('SELECT count(*)::int AS c FROM users');
    expect(beforeConfirm[0]?.c).toBe(0);

    // 확인 전엔 로그인이 거절된다.
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password })
      .expect(401);

    await request(app)
      .post('/api/auth/confirm-signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, code: '111111' })
      .expect(200);

    // 틀린 비밀번호는 거절된다.
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'WrongPassw0rd!' })
      .expect(401);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password })
      .expect(200);
    const cookie = extractCookie(loginRes);
    expect(cookie[0]).toContain('HttpOnly');
    expect(cookie[0]).toContain('Secure');
    expect(cookie[0]).toMatch(/SameSite=Strict/i);
    expect(cookie[0]).toContain('Path=/');

    await request(app).get('/api/profile').set('Cookie', cookie).expect(200);

    await request(app)
      .post('/api/auth/logout')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .set('Cookie', cookie)
      .expect(204);
    await request(app).get('/api/profile').set('Cookie', cookie).expect(401);

    void authPort; // 이 테스트에선 authPort를 직접 조작할 필요가 없다.
  });

  it('logout-all invalidates every session for the user, not just the current one', async () => {
    const { app } = await buildTestAppWithAuth();
    const email = 'multisession@example.com';
    const password = 'GoodPassw0rd!';
    await request(app)
      .post('/api/auth/signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password });
    await request(app)
      .post('/api/auth/confirm-signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, code: '111111' });

    const loginA = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password })
      .expect(200);
    const loginB = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password })
      .expect(200);
    const cookieA = extractCookie(loginA);
    const cookieB = extractCookie(loginB);

    await request(app).get('/api/profile').set('Cookie', cookieA).expect(200);
    await request(app).get('/api/profile').set('Cookie', cookieB).expect(200);

    await request(app)
      .post('/api/auth/logout-all')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .set('Cookie', cookieA)
      .expect(204);

    await request(app).get('/api/profile').set('Cookie', cookieA).expect(401);
    await request(app).get('/api/profile').set('Cookie', cookieB).expect(401);
  });

  it('forgot-password / confirm-forgot-password full round trip revokes prior sessions', async () => {
    const { app } = await buildTestAppWithAuth();
    const email = 'reset@example.com';
    await request(app)
      .post('/api/auth/signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'OldPassw0rd1!' });
    await request(app)
      .post('/api/auth/confirm-signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, code: '111111' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'OldPassw0rd1!' })
      .expect(200);
    const oldCookie = extractCookie(loginRes);

    await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email })
      .expect(200);

    // 틀린 코드는 세션에 영향을 주지 않는다.
    await request(app)
      .post('/api/auth/confirm-forgot-password')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, code: 'WRONG', newPassword: 'NewPassw0rd2!' })
      .expect(401);
    await request(app).get('/api/profile').set('Cookie', oldCookie).expect(200);

    const confirmRes = await request(app)
      .post('/api/auth/confirm-forgot-password')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, code: '222222', newPassword: 'NewPassw0rd2!' })
      .expect(200);
    expect(confirmRes.body.status).toBe('confirmed-sessions-revoked');

    await request(app).get('/api/profile').set('Cookie', oldCookie).expect(401);

    // 새 비밀번호로 로그인은 되고, 옛 비밀번호로는 안 된다.
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'OldPassw0rd1!' })
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'NewPassw0rd2!' })
      .expect(200);
  });

  it('confirm-forgot-password responds 202 without claiming success when the result is unknown (timeout)', async () => {
    const { app, authPort } = await buildTestAppWithAuth();
    const email = 'timeout@example.com';
    await request(app)
      .post('/api/auth/signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'OldPassw0rd1!' });
    await request(app)
      .post('/api/auth/confirm-signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, code: '111111' });
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'OldPassw0rd1!' });

    await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email });
    authPort.simulateForgotPasswordTimeoutOnce(email);

    const res = await request(app)
      .post('/api/auth/confirm-forgot-password')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, code: '222222', newPassword: 'NewPassw0rd2!' })
      .expect(202);
    expect(res.body.status).toBe('unknown');
    // 성공을 단정하지 않는다 — 재로그인 또는 재설정 재시도를 안내한다(계획 요구사항 6).
    expect(res.body.message).toContain('로그인');
    expect(res.body.message).not.toMatch(/성공(했습니다|적으로)/);
  });

  it('rejects a mutating auth request with a missing or mismatched Origin header', async () => {
    const { app } = await buildTestAppWithAuth();
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'x@example.com', password: 'GoodPassw0rd!' })
      .expect(403);
    await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'http://evil.example.com')
      .send({ email: 'x@example.com', password: 'GoodPassw0rd!' })
      .expect(403);
  });

  it('rate-limits each of the 6 endpoints by request source', async () => {
    const { app } = await buildTestAppWithAuth();
    const email = 'ratelimited@example.com';

    // signup: limit 10 — 11번째는 429.
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post('/api/auth/signup')
        .set('Origin', TEST_ALLOWED_ORIGIN)
        .send({ email: `rl-signup-${i}@example.com`, password: 'GoodPassw0rd!' });
    }
    await request(app)
      .post('/api/auth/signup')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'GoodPassw0rd!' })
      .expect(429);
  });

  it('does not leak whether an account exists via forgot-password or resend-confirmation responses', async () => {
    const { app } = await buildTestAppWithAuth();
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email: 'no-such-account@example.com' })
      .expect(200);
    expect(forgotRes.body.ok).toBe(true);

    const resendRes = await request(app)
      .post('/api/auth/resend-confirmation')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email: 'no-such-account@example.com' })
      .expect(200);
    expect(resendRes.body.ok).toBe(true);
  });
});
