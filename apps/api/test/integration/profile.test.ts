import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, TEST_ALLOWED_ORIGIN } from '../helpers/app';
import { resetTables, getTestPool } from '../helpers/db';
import { createUser } from '../../src/repositories/usersRepository';

describe('profile API', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('rejects requests without a test user id', async () => {
    const app = await buildTestApp();
    await request(app).get('/api/profile').expect(401);
  });

  it("returns and updates the authenticated user's profile", async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    const getRes = await request(app)
      .get('/api/profile')
      .set('X-Test-User-Id', user.id)
      .expect(200);
    expect(getRes.body.email).toBe('a@example.com');
    expect(getRes.body.analysis_consent).toBe(false);

    const patchRes = await request(app)
      .patch('/api/profile')
      .set('X-Test-User-Id', user.id)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ nickname: '민준' })
      .expect(200);
    expect(patchRes.body.nickname).toBe('민준');
  });

  it('rejects a blank nickname', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    await request(app)
      .patch('/api/profile')
      .set('X-Test-User-Id', user.id)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ nickname: '   ' })
      .expect(400);
  });

  it('rejects a mutating request with a missing or mismatched Origin header', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    await request(app)
      .patch('/api/profile')
      .set('X-Test-User-Id', user.id)
      .send({ nickname: '민준' })
      .expect(403);

    await request(app)
      .patch('/api/profile')
      .set('X-Test-User-Id', user.id)
      .set('Origin', 'http://evil.example.com')
      .send({ nickname: '민준' })
      .expect(403);
  });
});
