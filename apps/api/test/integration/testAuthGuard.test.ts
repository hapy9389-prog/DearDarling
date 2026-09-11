import { describe, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { getTestPool, resetTables } from '../helpers/db';
import { createStubAuthPort } from '../../src/cognito/stubAuthPort';
import { TEST_ALLOWED_ORIGIN } from '../helpers/app';

describe('test-mode auth is opt-in only', () => {
  it('does not expose the test user creation route when localTestAuth is false', async () => {
    await resetTables();
    const pool = await getTestPool();
    const app = createApp({
      pool,
      localTestAuth: false,
      allowedOrigin: TEST_ALLOWED_ORIGIN,
      authPort: createStubAuthPort(),
    });
    await request(app).post('/api/test/users').send({ email: 'x@example.com' }).expect(404);
  });

  it('ignores the X-Test-User-Id header entirely when localTestAuth is false', async () => {
    const pool = await getTestPool();
    const app = createApp({
      pool,
      localTestAuth: false,
      allowedOrigin: TEST_ALLOWED_ORIGIN,
      authPort: createStubAuthPort(),
    });
    await request(app).get('/api/profile').set('X-Test-User-Id', 'anything').expect(401);
  });
});
