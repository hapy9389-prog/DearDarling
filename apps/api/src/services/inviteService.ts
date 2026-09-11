import type { Pool } from 'pg';
import { generateCode, normalizeCode, INVITE_TTL_MS } from '../domain/invite';
import { withRetry } from '../db/retry';

export type InviteAcceptReason =
  | 'not-found'
  | 'expired'
  | 'revoked'
  | 'already-accepted'
  | 'self'
  | 'accepter-already-connected'
  | 'inviter-already-connected';

export class InviteAcceptFailure extends Error {
  constructor(public readonly reason: InviteAcceptReason) {
    super(`invite accept failed: ${reason}`);
  }
}

export interface InviteRow {
  id: string;
  code: string;
  inviter_user_id: string;
  accepted_by_user_id: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

const UNIQUE_VIOLATION = '23505';
// 부분 유니크 인덱스(사용자당 활성 초대 1개) 위반 — DB 스키마의 이름과 반드시 일치해야 한다.
const ONE_PENDING_PER_INVITER_CONSTRAINT = 'invites_one_pending_per_inviter';
// invites.code UNIQUE 제약의 기본 명명 규칙(<table>_<column>_key) — 무작위 코드 충돌.
const CODE_UNIQUE_CONSTRAINT = 'invites_code_key';

/**
 * 발급 직전에 이미 만료된 pending 초대를 지연 정리한다. 그렇지 않으면 부분 유니크 인덱스
 * (`invites_one_pending_per_inviter`, status='pending' 조건)가 실제로는 만료된 옛 초대 때문에
 * 새 초대 발급을 계속 막게 된다.
 */
async function expireStalePendingInvites(
  client: { query: Pool['query'] },
  inviterUserId: string,
): Promise<void> {
  await client.query(
    `UPDATE invites SET status = 'expired'
     WHERE inviter_user_id = $1 AND status = 'pending' AND expires_at <= now()`,
    [inviterUserId],
  );
}

/**
 * 초대를 만들거나, 이미 활성 초대가 있으면 그걸 그대로 돌려준다(재발급을 에러로 취급하지 않음).
 *
 * 무작위 코드 충돌과 "이미 활성 초대가 있음"은 둘 다 invites 테이블의 유니크 위반(23505)으로
 * 나타나지만 원인이 다르므로 PostgreSQL 오류의 `constraint` 이름으로 구분한다:
 * - `invites_one_pending_per_inviter`(부분 유니크 인덱스) 위반 → 기존 활성 초대를 조회해 반환.
 * - `invites_code_key`(코드 컬럼 유니크) 위반 → 무작위 코드 충돌, 새 코드로 재시도.
 *
 * 한 번 실패한 문장이 있으면 PostgreSQL은 트랜잭션 전체를 "실패" 상태로 만들어 이후 문장을
 * 전부 거부한다 — 그래서 실패한 트랜잭션을 그대로 두고 INSERT를 재시도하지 않는다.
 * 매 시도 전에 SAVEPOINT를 찍고, 실패하면 그 지점으로만 롤백해 트랜잭션 자체는 계속 쓴다.
 */
export async function createInvite(pool: Pool, inviterUserId: string): Promise<InviteRow> {
  return withRetry(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expireStalePendingInvites(client, inviterUserId);

      const { rows: userRows } = await client.query<{ couple_id: string | null }>(
        'SELECT couple_id FROM users WHERE id = $1 FOR UPDATE',
        [inviterUserId],
      );
      if (!userRows[0]) throw new Error('초대를 만들려는 사용자를 찾을 수 없습니다.');
      if (userRows[0].couple_id) throw new InviteAcceptFailure('inviter-already-connected');

      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      let inserted: InviteRow | undefined;
      for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
        const code = generateCode();
        await client.query('SAVEPOINT invite_insert');
        try {
          const { rows } = await client.query<InviteRow>(
            `INSERT INTO invites (code, inviter_user_id, expires_at)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [code, inviterUserId, expiresAt],
          );
          inserted = rows[0];
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT invite_insert');
          const pgErr = err as PgErrorLike;
          if (pgErr.code !== UNIQUE_VIOLATION) throw err;

          if (pgErr.constraint === ONE_PENDING_PER_INVITER_CONSTRAINT) {
            const { rows: existingRows } = await client.query<InviteRow>(
              `SELECT * FROM invites WHERE inviter_user_id = $1 AND status = 'pending'`,
              [inviterUserId],
            );
            const existing = existingRows[0];
            if (!existing) throw err; // 예상치 못한 상태 — 원래 오류를 그대로 전달
            await client.query('COMMIT');
            return existing;
          }
          if (pgErr.constraint === CODE_UNIQUE_CONSTRAINT) continue; // 무작위 코드 충돌 — 재생성
          throw err;
        }
      }
      if (!inserted) throw new Error('초대 코드 생성에 반복 실패했습니다.');

      await client.query('COMMIT');
      return inserted;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}

export async function revokeInvite(pool: Pool, code: string, inviterUserId: string): Promise<void> {
  await pool.query(
    `UPDATE invites SET status = 'revoked'
     WHERE code = $1 AND inviter_user_id = $2 AND status = 'pending'`,
    [normalizeCode(code), inviterUserId],
  );
}

/**
 * 초대 수락 + 커플 연결을 하나의 트랜잭션으로 처리한다.
 *
 * 동시성 안전장치:
 * - `SELECT ... FOR UPDATE`로 초대 행을 잠가, 같은 코드를 동시에 수락하려는 요청은
 *   한쪽이 커밋될 때까지 대기했다가 최신 상태('accepted')를 보고 실패한다.
 * - 두 사용자 행을 id 오름차순으로 잠가(교착상태 가능성을 줄임) couple_id가 NULL인지 확인한다.
 * - 서로 다른 초대 코드로 같은 사용자를 동시에 연결하려는 경합은 두 사용자 행에 대한
 *   조건부 UPDATE(`WHERE couple_id IS NULL`)의 영향받은 행 수가 2가 아니면 감지해 롤백한다.
 * - 직렬화 오류(40001)·교착상태(40P01)는 withRetry가 짧은 backoff 후 재시도한다.
 */
export async function acceptInvite(
  pool: Pool,
  rawCode: string,
  accepterUserId: string,
  relationshipStartDate: string | null,
): Promise<{ coupleId: string }> {
  const code = normalizeCode(rawCode);
  return withRetry(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: inviteRows } = await client.query<InviteRow>(
        'SELECT * FROM invites WHERE code = $1 FOR UPDATE',
        [code],
      );
      const invite = inviteRows[0];
      if (!invite) throw new InviteAcceptFailure('not-found');
      if (invite.status === 'revoked') throw new InviteAcceptFailure('revoked');
      if (invite.status === 'accepted') throw new InviteAcceptFailure('already-accepted');
      if (invite.status === 'expired' || invite.expires_at.getTime() <= Date.now()) {
        if (invite.status === 'pending') {
          await client.query(`UPDATE invites SET status = 'expired' WHERE id = $1`, [invite.id]);
        }
        throw new InviteAcceptFailure('expired');
      }
      if (invite.inviter_user_id === accepterUserId) throw new InviteAcceptFailure('self');

      const [firstId, secondId] = [invite.inviter_user_id, accepterUserId].sort();
      const { rows: lockedUsers } = await client.query<{ id: string; couple_id: string | null }>(
        'SELECT id, couple_id FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
        [firstId, secondId],
      );
      const inviterRow = lockedUsers.find((u) => u.id === invite.inviter_user_id);
      const accepterRow = lockedUsers.find((u) => u.id === accepterUserId);
      if (inviterRow?.couple_id) throw new InviteAcceptFailure('inviter-already-connected');
      if (accepterRow?.couple_id) throw new InviteAcceptFailure('accepter-already-connected');

      const { rows: coupleRows } = await client.query<{ id: string }>(
        'INSERT INTO couples (relationship_start_date) VALUES ($1) RETURNING id',
        [relationshipStartDate],
      );
      const coupleId = coupleRows[0]?.id;
      if (!coupleId) throw new Error('커플 생성에 실패했습니다.');

      const { rowCount } = await client.query(
        'UPDATE users SET couple_id = $1 WHERE id IN ($2, $3) AND couple_id IS NULL',
        [coupleId, invite.inviter_user_id, accepterUserId],
      );
      if (rowCount !== 2) {
        // 서로 다른 초대 코드로 같은 사용자를 동시에 연결하려던 경합 — 안전망으로 감지·차단.
        throw new InviteAcceptFailure('accepter-already-connected');
      }

      await client.query(
        `UPDATE invites SET status = 'accepted', accepted_by_user_id = $2, accepted_at = now()
         WHERE id = $1`,
        [invite.id, accepterUserId],
      );
      // 연결 완료 후 양쪽의 남은 활성 초대를 모두 무효화한다.
      await client.query(
        `UPDATE invites SET status = 'revoked'
         WHERE inviter_user_id IN ($1, $2) AND status = 'pending' AND id <> $3`,
        [invite.inviter_user_id, accepterUserId, invite.id],
      );

      await client.query('COMMIT');
      return { coupleId };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}
