import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, TEST_ALLOWED_ORIGIN } from '../helpers/app';
import { resetTables, getTestPool } from '../helpers/db';
import { createUser } from '../../src/repositories/usersRepository';
import { createInvite, acceptInvite } from '../../src/services/inviteService';

describe('couple API', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('round-trips relationship_start_date without a timezone off-by-one-day shift', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    await acceptInvite(pool, invite.code, accepter.id, '2025-01-01');

    const res = await request(app).get('/api/couple').set('X-Test-User-Id', inviter.id).expect(200);
    // KST(UTC+9)처럼 UTC보다 앞선 타임존에서 pg의 기본 DATE 파서를 쓰면 로컬 자정 기준
    // Date 객체로 바뀌어 '2024-12-31...'로 하루 밀려 보이는 회귀가 있었다(src/db/pool.ts 참고).
    expect(res.body.relationship_start_date).toBe('2025-01-01');
  });

  it('updates relationship_start_date to a valid value', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    await acceptInvite(pool, invite.code, accepter.id, null);

    const updated = await request(app)
      .patch('/api/couple')
      .set('X-Test-User-Id', accepter.id)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ relationshipStartDate: '2024-06-15' })
      .expect(200);
    expect(updated.body.relationship_start_date).toBe('2024-06-15');
  });

  it('keeps the existing value when the field is omitted from the request body', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    await acceptInvite(pool, invite.code, accepter.id, '2025-01-01');

    const res = await request(app)
      .patch('/api/couple')
      .set('X-Test-User-Id', accepter.id)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({}) // relationshipStartDate 필드 자체가 없음
      .expect(200);
    expect(res.body.relationship_start_date).toBe('2025-01-01');
  });

  it('clears relationship_start_date only when the field is explicitly null', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    await acceptInvite(pool, invite.code, accepter.id, '2025-01-01');

    const res = await request(app)
      .patch('/api/couple')
      .set('X-Test-User-Id', accepter.id)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ relationshipStartDate: null })
      .expect(200);
    expect(res.body.relationship_start_date).toBeNull();
  });

  it('rejects a malformed or non-existent date and leaves the existing value unchanged', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    await acceptInvite(pool, invite.code, accepter.id, '2025-01-01');

    for (const invalid of ['2025-02-30', 'not-a-date', '', 20250101, '2025/01/01']) {
      await request(app)
        .patch('/api/couple')
        .set('X-Test-User-Id', accepter.id)
        .set('Origin', TEST_ALLOWED_ORIGIN)
        .send({ relationshipStartDate: invalid })
        .expect(400);
    }

    const res = await request(app)
      .get('/api/couple')
      .set('X-Test-User-Id', accepter.id)
      .expect(200);
    expect(res.body.relationship_start_date).toBe('2025-01-01'); // 그대로 유지
  });
});
