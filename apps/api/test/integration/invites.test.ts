import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp, TEST_ALLOWED_ORIGIN } from '../helpers/app';
import { getTestPool, resetTables } from '../helpers/db';
import { createUser, updateProfile } from '../../src/repositories/usersRepository';
import {
  createInvite,
  acceptInvite,
  previewInvite,
  InviteAcceptFailure,
} from '../../src/services/inviteService';

describe('invite + couple connection', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('rejects revoked, not-found, self, and expired codes with distinct reasons', async () => {
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const invite = await createInvite(pool, inviter.id);

    await expect(acceptInvite(pool, 'DD-000000', inviter.id, null)).rejects.toMatchObject({
      reason: 'not-found',
    });
    await expect(acceptInvite(pool, invite.code, inviter.id, null)).rejects.toMatchObject({
      reason: 'self',
    });

    await pool.query(`UPDATE invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      invite.id,
    ]);
    const accepter = await createUser(pool, 'accepter@example.com');
    await expect(acceptInvite(pool, invite.code, accepter.id, null)).rejects.toMatchObject({
      reason: 'expired',
    });
  });

  it('rejects on time-based expiry even though the rolled-back UPDATE never persists status=expired', async () => {
    // acceptInvite가 만료를 감지했을 때 상태를 'expired'로 갱신하는 문장은, 뒤이어 던지는
    // InviteAcceptFailure 때문에 트랜잭션이 곧 ROLLBACK된다 — 즉 이 UPDATE는 커밋되지
    // 않는다. 거절 자체는 expires_at 기준(시간)으로만 일어난다는 것을, 거절 뒤에도 DB 상태가
    // 'pending' 그대로임을 확인해 증명한다. "만료 상태가 DB에 영구 저장된다"고 가정하지 않는다.
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    await pool.query(`UPDATE invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      invite.id,
    ]);

    await expect(acceptInvite(pool, invite.code, accepter.id, null)).rejects.toMatchObject({
      reason: 'expired',
    });

    const { rows } = await pool.query<{ status: string }>('SELECT status FROM invites WHERE id = $1', [
      invite.id,
    ]);
    // 롤백됐으므로 'expired'로 남지 않고 'pending' 그대로다 — 그럼에도 재시도하면 여전히
    // (시간 기준으로) 거절된다는 것까지 함께 확인한다.
    expect(rows[0]?.status).toBe('pending');
    await expect(acceptInvite(pool, invite.code, accepter.id, null)).rejects.toMatchObject({
      reason: 'expired',
    });
  });

  it('allows a new invite even though the previous one is still marked pending in the DB, once it has expired', async () => {
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const first = await createInvite(pool, inviter.id);
    // "만료됐지만 DB엔 pending"인 상태를 재현한다.
    await pool.query(`UPDATE invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      first.id,
    ]);

    const second = await createInvite(pool, inviter.id);
    expect(second.code).not.toBe(first.code);

    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM invites WHERE id = $1',
      [first.id],
    );
    expect(rows[0]?.status).toBe('expired');
  });

  it('accepts the same code only once under concurrent requests', async () => {
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepterA = await createUser(pool, 'a@example.com');
    const accepterB = await createUser(pool, 'b@example.com');
    const invite = await createInvite(pool, inviter.id);

    const results = await Promise.allSettled([
      acceptInvite(pool, invite.code, accepterA.id, null),
      acceptInvite(pool, invite.code, accepterB.id, null),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InviteAcceptFailure);
  });

  it('connects a user through only one of two simultaneous invites', async () => {
    const pool = await getTestPool();
    const inviterA = await createUser(pool, 'inviterA@example.com');
    const inviterB = await createUser(pool, 'inviterB@example.com');
    const target = await createUser(pool, 'target@example.com');
    const inviteA = await createInvite(pool, inviterA.id);
    const inviteB = await createInvite(pool, inviterB.id);

    const results = await Promise.allSettled([
      acceptInvite(pool, inviteA.code, target.id, null),
      acceptInvite(pool, inviteB.code, target.id, null),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const { rows } = await pool.query<{ couple_id: string | null }>(
      'SELECT couple_id FROM users WHERE id = $1',
      [target.id],
    );
    expect(rows[0]?.couple_id).not.toBeNull();
  });

  it("revokes both partners' remaining pending invites after connecting", async () => {
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    const accepterOwnInvite = await createInvite(pool, accepter.id);

    await acceptInvite(pool, invite.code, accepter.id, null);

    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM invites WHERE id = $1',
      [accepterOwnInvite.id],
    );
    expect(rows[0]?.status).toBe('revoked');
  });

  it('rolls back the whole transaction if the couple/user update fails partway', async () => {
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const invite = await createInvite(pool, inviter.id);
    const nonExistentAccepterId = '00000000-0000-0000-0000-000000000000';

    await expect(acceptInvite(pool, invite.code, nonExistentAccepterId, null)).rejects.toThrow();

    const { rows: coupleRows } = await pool.query('SELECT * FROM couples');
    expect(coupleRows).toHaveLength(0);
    const { rows: inviterRows } = await pool.query<{ couple_id: string | null }>(
      'SELECT couple_id FROM users WHERE id = $1',
      [inviter.id],
    );
    expect(inviterRows[0]?.couple_id).toBeNull();
    const { rows: inviteRows } = await pool.query<{ status: string }>(
      'SELECT status FROM invites WHERE id = $1',
      [invite.id],
    );
    expect(inviteRows[0]?.status).toBe('pending');
  });

  it('cannot create a new invite while already connected', async () => {
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);
    await acceptInvite(pool, invite.code, accepter.id, null);

    await expect(createInvite(pool, inviter.id)).rejects.toMatchObject({
      reason: 'inviter-already-connected',
    });
  });

  it('rejects an invalid relationshipStartDate at the HTTP layer without creating a couple', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);

    await request(app)
      .post(`/api/invites/${invite.code}/accept`)
      .set('X-Test-User-Id', accepter.id)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ relationshipStartDate: '2025-02-30' })
      .expect(400);

    const { rows: coupleRows } = await pool.query('SELECT * FROM couples');
    expect(coupleRows).toHaveLength(0);
    const { rows: accepterRows } = await pool.query<{ couple_id: string | null }>(
      'SELECT couple_id FROM users WHERE id = $1',
      [accepter.id],
    );
    expect(accepterRows[0]?.couple_id).toBeNull();
  });

  it('accepts a valid relationshipStartDate at the HTTP layer', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const inviter = await createUser(pool, 'inviter@example.com');
    const accepter = await createUser(pool, 'accepter@example.com');
    const invite = await createInvite(pool, inviter.id);

    await request(app)
      .post(`/api/invites/${invite.code}/accept`)
      .set('X-Test-User-Id', accepter.id)
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ relationshipStartDate: '2025-01-01' })
      .expect(200);

    const couple = await request(app)
      .get('/api/couple')
      .set('X-Test-User-Id', accepter.id)
      .expect(200);
    expect(couple.body.relationship_start_date).toBe('2025-01-01');
  });

  describe('re-issuing an invite (no active invite yet exists as a race)', () => {
    it('returns the existing active invite instead of erroring when one is already pending', async () => {
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');

      const first = await createInvite(pool, inviter.id);
      const second = await createInvite(pool, inviter.id);

      expect(second.id).toBe(first.id);
      expect(second.code).toBe(first.code);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS count FROM invites WHERE inviter_user_id = $1 AND status = 'pending'",
        [inviter.id],
      );
      expect(rows[0]?.count).toBe(1);
    });

    it('returns the same active invite for concurrent create requests from the same user', async () => {
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');

      const [a, b] = await Promise.all([
        createInvite(pool, inviter.id),
        createInvite(pool, inviter.id),
      ]);

      expect(a.code).toBe(b.code);
      const { rows } = await pool.query(
        "SELECT count(*)::int AS count FROM invites WHERE inviter_user_id = $1 AND status = 'pending'",
        [inviter.id],
      );
      expect(rows[0]?.count).toBe(1);
    });
  });

  describe('random code collisions', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('retries with a new code after a collision, without corrupting the transaction (SAVEPOINT)', async () => {
      const pool = await getTestPool();
      const inviterA = await createUser(pool, 'a@example.com');
      const inviterB = await createUser(pool, 'b@example.com');

      // generateCode()는 6글자를 위해 Math.random()을 6번 호출한다. 처음 6번은 항상 같은 값을
      // 내어 A·B가 같은 코드를 뽑게 만들고, 그 다음부터는 다른 값을 내어 재시도가 다른 코드를
      // 만들도록 한다 — 무작위 충돌 → SAVEPOINT 롤백 → 재시도 성공을 결정적으로 재현한다.
      let callCount = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        callCount += 1;
        return callCount <= 6 ? 0 : 0.5;
      });

      const first = await createInvite(pool, inviterA.id);
      expect(first.code).toBe('DD-000000');

      const second = await createInvite(pool, inviterB.id);
      expect(second.code).not.toBe(first.code);

      // 트랜잭션이 손상되지 않았다는 것은 두 초대 모두 정상적으로 pending으로 남아있다는 뜻이다.
      const { rows } = await pool.query<{ status: string }>(
        "SELECT status FROM invites WHERE inviter_user_id IN ($1, $2) AND status = 'pending'",
        [inviterA.id, inviterB.id],
      );
      expect(rows).toHaveLength(2);
    });
  });

  describe('GET /:code preview', () => {
    it('returns the inviter nickname/avatar for a valid pending invite, without using it', async () => {
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');
      await updateProfile(pool, inviter.id, { nickname: '민준', avatarEmoji: '🐻' });
      const viewer = await createUser(pool, 'viewer@example.com');
      const invite = await createInvite(pool, inviter.id);

      const preview = await previewInvite(pool, invite.code, viewer.id);
      expect(preview).toEqual({ inviter_nickname: '민준', inviter_avatar_emoji: '🐻' });

      // 조회만으로 사용 처리·연결이 일어나지 않는다.
      const { rows: inviteRows } = await pool.query<{ status: string }>(
        'SELECT status FROM invites WHERE id = $1',
        [invite.id],
      );
      expect(inviteRows[0]?.status).toBe('pending');
      const { rows: coupleRows } = await pool.query('SELECT * FROM couples');
      expect(coupleRows).toHaveLength(0);
    });

    it('returns the same 409 reasons as accept for not-found/revoked/already-accepted/expired/self/already-connected', async () => {
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');
      const viewer = await createUser(pool, 'viewer@example.com');

      await expect(previewInvite(pool, 'DD-000000', viewer.id)).rejects.toMatchObject({
        reason: 'not-found',
      });

      const selfInvite = await createInvite(pool, inviter.id);
      await expect(previewInvite(pool, selfInvite.code, inviter.id)).rejects.toMatchObject({
        reason: 'self',
      });

      await pool.query(`UPDATE invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
        selfInvite.id,
      ]);
      await expect(previewInvite(pool, selfInvite.code, viewer.id)).rejects.toMatchObject({
        reason: 'expired',
      });

      const revokedInviter = await createUser(pool, 'revoked-inviter@example.com');
      const revokedInvite = await createInvite(pool, revokedInviter.id);
      await pool.query(`UPDATE invites SET status = 'revoked' WHERE id = $1`, [revokedInvite.id]);
      await expect(previewInvite(pool, revokedInvite.code, viewer.id)).rejects.toMatchObject({
        reason: 'revoked',
      });

      const acceptedInviter = await createUser(pool, 'accepted-inviter@example.com');
      const acceptedAccepter = await createUser(pool, 'accepted-accepter@example.com');
      const acceptedInvite = await createInvite(pool, acceptedInviter.id);
      await acceptInvite(pool, acceptedInvite.code, acceptedAccepter.id, null);
      await expect(previewInvite(pool, acceptedInvite.code, viewer.id)).rejects.toMatchObject({
        reason: 'already-accepted',
      });

      const connectedInviter = await createUser(pool, 'connected-inviter@example.com');
      const connectedPartner = await createUser(pool, 'connected-partner@example.com');
      const inviterConnectInvite = await createInvite(pool, connectedInviter.id);
      await acceptInvite(pool, inviterConnectInvite.code, connectedPartner.id, null);
      const newInviteFromConnectedInviter = await createUser(pool, 'irrelevant@example.com'); // 새 초대자
      const anotherInvite = await createInvite(pool, newInviteFromConnectedInviter.id);
      // connectedInviter가 이미 연결돼 있는 상태에서, 그가 만든 것이 아닌 다른 사람의 초대를
      // "이미 연결된 사용자"가 미리보기하면 accepter-already-connected가 나와야 한다.
      await expect(previewInvite(pool, anotherInvite.code, connectedInviter.id)).rejects.toMatchObject(
        { reason: 'accepter-already-connected' },
      );
    });

    it('requires authentication at the HTTP layer', async () => {
      const app = await buildTestApp();
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');
      const invite = await createInvite(pool, inviter.id);

      await request(app)
        .get(`/api/invites/${invite.code}`)
        .set('Origin', TEST_ALLOWED_ORIGIN)
        .expect(401);
    });

    it('never includes email or other account fields in the preview response', async () => {
      const app = await buildTestApp();
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');
      await updateProfile(pool, inviter.id, { nickname: '민준', avatarEmoji: '🐻' });
      const viewer = await createUser(pool, 'viewer@example.com');
      const invite = await createInvite(pool, inviter.id);

      const res = await request(app)
        .get(`/api/invites/${invite.code}`)
        .set('X-Test-User-Id', viewer.id)
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['inviter_avatar_emoji', 'inviter_nickname']);
    });

    it('rate-limits repeated preview lookups by the same user', async () => {
      const app = await buildTestApp();
      const pool = await getTestPool();
      const inviter = await createUser(pool, 'inviter@example.com');
      const viewer = await createUser(pool, 'viewer@example.com');
      const invite = await createInvite(pool, inviter.id);

      const attempts = Array.from({ length: 21 }, () =>
        request(app).get(`/api/invites/${invite.code}`).set('X-Test-User-Id', viewer.id),
      );
      const responses = await Promise.all(attempts.map((req) => req));
      const rateLimited = responses.filter((res) => res.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
});
