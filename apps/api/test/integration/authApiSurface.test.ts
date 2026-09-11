import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetTables } from '../helpers/db';
import { buildTestAppWithAuth, TEST_ALLOWED_ORIGIN, extractCookie } from '../helpers/app';

describe('GET /api/auth/me — authentication status only, no secrets', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('reports unauthenticated with no cookie', async () => {
    const { app } = await buildTestAppWithAuth();
    const res = await request(app).get('/api/auth/me').expect(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('reports authenticated with a valid session, and never returns email/password/etc', async () => {
    const { app, authPort } = await buildTestAppWithAuth();
    const email = 'me-status@example.com';
    authPort.seedConfirmedUser(email, 'GoodPassw0rd!');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'GoodPassw0rd!' })
      .expect(200);
    const cookie = extractCookie(loginRes);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(res.body.authenticated).toBe(true);
    expect(typeof res.body.userId).toBe('string');
    expect(res.body).not.toHaveProperty('email');
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('sessionId');
  });

  it('reports unauthenticated after the session has expired', async () => {
    const { app, authPort } = await buildTestAppWithAuth();
    const email = 'me-expired@example.com';
    authPort.seedConfirmedUser(email, 'GoodPassw0rd!');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'GoodPassw0rd!' })
      .expect(200);
    const cookie = extractCookie(loginRes);

    const { getTestPool } = await import('../helpers/db');
    const pool = await getTestPool();
    await pool.query(`UPDATE sessions SET expires_at = clock_timestamp() - interval '1 second'`);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('reports unauthenticated after logout', async () => {
    const { app, authPort } = await buildTestAppWithAuth();
    const email = 'me-loggedout@example.com';
    authPort.seedConfirmedUser(email, 'GoodPassw0rd!');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'GoodPassw0rd!' })
      .expect(200);
    const cookie = extractCookie(loginRes);

    await request(app)
      .post('/api/auth/logout')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .set('Cookie', cookie)
      .expect(204);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual({ authenticated: false });
  });
});

describe('per-endpoint request rate limiting (source IP dimension) for all 6 auth endpoints', () => {
  beforeEach(async () => {
    await resetTables();
  });

  const cases: Array<{
    path: string;
    ipLimit: number;
    body: (i: number) => Record<string, unknown>;
  }> = [
    {
      path: '/api/auth/signup',
      ipLimit: 10,
      body: (i) => ({ email: `rl-su-${i}@example.com`, password: 'GoodPassw0rd!' }),
    },
    {
      path: '/api/auth/confirm-signup',
      ipLimit: 10,
      body: (i) => ({ email: `rl-cs-${i}@example.com`, code: '000000' }),
    },
    {
      path: '/api/auth/resend-confirmation',
      ipLimit: 5,
      body: (i) => ({ email: `rl-rc-${i}@example.com` }),
    },
    {
      path: '/api/auth/login',
      ipLimit: 20,
      body: (i) => ({ email: `rl-li-${i}@example.com`, password: 'GoodPassw0rd!' }),
    },
    {
      path: '/api/auth/forgot-password',
      ipLimit: 10,
      body: (i) => ({ email: `rl-fp-${i}@example.com` }),
    },
    {
      path: '/api/auth/confirm-forgot-password',
      ipLimit: 10,
      body: (i) => ({
        email: `rl-cfp-${i}@example.com`,
        code: '000000',
        newPassword: 'GoodPassw0rd!',
      }),
    },
  ];

  it.each(cases)(
    '$path returns 429 once the IP limit ($ipLimit per 10 min) is exceeded',
    async ({ path, ipLimit, body }) => {
      const { app } = await buildTestAppWithAuth();
      // 매번 다른 이메일을 써서 이메일 기준 제한이 아니라 IP 기준 제한만 순수하게 확인한다.
      for (let i = 0; i < ipLimit; i += 1) {
        await request(app).post(path).set('Origin', TEST_ALLOWED_ORIGIN).send(body(i));
      }
      await request(app)
        .post(path)
        .set('Origin', TEST_ALLOWED_ORIGIN)
        .send(body(ipLimit))
        .expect(429);
    },
  );

  it('resend-confirmation additionally enforces a 1-per-minute interval limit for the same email', async () => {
    const { app } = await buildTestAppWithAuth();
    const email = 'interval-limited@example.com';
    await request(app)
      .post('/api/auth/resend-confirmation')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email })
      .expect(200);
    await request(app)
      .post('/api/auth/resend-confirmation')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email })
      .expect(429);
  });

  it('the email dimension also limits independently of source IP for login', async () => {
    const { app, authPort } = await buildTestAppWithAuth();
    const email = 'email-rate-limited@example.com';
    authPort.seedConfirmedUser(email, 'GoodPassw0rd!');
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post('/api/auth/login')
        .set('Origin', TEST_ALLOWED_ORIGIN)
        .send({ email, password: 'WrongPassword!' });
    }
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'GoodPassw0rd!' }) // 맞는 비밀번호라도 이메일 기준 제한에 걸린다
      .expect(429);
  });
});
