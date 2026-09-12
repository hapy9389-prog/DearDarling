import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, TEST_ALLOWED_ORIGIN } from '../helpers/app';
import { resetTables, getTestPool } from '../helpers/db';
import { createUser, updateProfile } from '../../src/repositories/usersRepository';
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

  describe('partner info', () => {
    it('returns the partner nickname/avatar on both GET and PATCH, scoped to my own couple_id', async () => {
      const app = await buildTestApp();
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');
      await updateProfile(pool, inviter.id, { nickname: '민준', avatarEmoji: '🐻' });
      const accepter = await createUser(pool, 'accepter@example.com');
      await updateProfile(pool, accepter.id, { nickname: '서연', avatarEmoji: '🐥' });
      const invite = await createInvite(pool, inviter.id);
      await acceptInvite(pool, invite.code, accepter.id, null);

      const inviterView = await request(app)
        .get('/api/couple')
        .set('X-Test-User-Id', inviter.id)
        .expect(200);
      expect(inviterView.body.partner).toEqual({ nickname: '서연', avatar_emoji: '🐥' });

      const accepterView = await request(app)
        .get('/api/couple')
        .set('X-Test-User-Id', accepter.id)
        .expect(200);
      expect(accepterView.body.partner).toEqual({ nickname: '민준', avatar_emoji: '🐻' });

      const patched = await request(app)
        .patch('/api/couple')
        .set('X-Test-User-Id', accepter.id)
        .set('Origin', TEST_ALLOWED_ORIGIN)
        .send({}) // 필드 생략 — 응답 조립 경로가 다른 GET과 동일하게 partner를 포함하는지 확인
        .expect(200);
      expect(patched.body.partner).toEqual({ nickname: '민준', avatar_emoji: '🐻' });
    });

    it('never leaks a third, unrelated couple\'s members into my response (no cross-couple access)', async () => {
      const app = await buildTestApp();
      const pool = await getTestPool();

      // 커플 1
      const inviter1 = await createUser(pool, 'inviter1@example.com');
      await updateProfile(pool, inviter1.id, { nickname: '민준' });
      const accepter1 = await createUser(pool, 'accepter1@example.com');
      const invite1 = await createInvite(pool, inviter1.id);
      await acceptInvite(pool, invite1.code, accepter1.id, null);

      // 커플 2(완전히 무관한 다른 커플)
      const inviter2 = await createUser(pool, 'inviter2@example.com');
      const accepter2 = await createUser(pool, 'accepter2@example.com');
      await updateProfile(pool, accepter2.id, { nickname: '다른사람' });
      const invite2 = await createInvite(pool, inviter2.id);
      await acceptInvite(pool, invite2.code, accepter2.id, null);

      const res = await request(app)
        .get('/api/couple')
        .set('X-Test-User-Id', accepter1.id)
        .expect(200);
      expect(res.body.partner.nickname).toBe('민준');
      expect(res.body.partner.nickname).not.toBe('다른사람');
      expect(JSON.stringify(res.body)).not.toContain('다른사람');
    });

    it('never includes email or other account fields in the partner object', async () => {
      const app = await buildTestApp();
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');
      const accepter = await createUser(pool, 'accepter@example.com');
      const invite = await createInvite(pool, inviter.id);
      await acceptInvite(pool, invite.code, accepter.id, null);

      const res = await request(app)
        .get('/api/couple')
        .set('X-Test-User-Id', inviter.id)
        .expect(200);
      expect(Object.keys(res.body.partner).sort()).toEqual(['avatar_emoji', 'nickname']);
      expect(JSON.stringify(res.body)).not.toContain('accepter@example.com');
    });
  });
});
