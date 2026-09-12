import type { Pool, PoolClient } from 'pg';

export interface CoupleRow {
  id: string;
  connected_at: Date;
  relationship_start_date: string | null;
  is_seed: boolean;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

export async function findCoupleById(db: Queryable, id: string): Promise<CoupleRow | null> {
  const { rows } = await db.query<CoupleRow>('SELECT * FROM couples WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export interface PartnerInfo {
  nickname: string | null;
  avatar_emoji: string | null;
}

/**
 * 같은 커플의 "상대방" 정보만 딱 이 두 컬럼으로 조회한다 — 이메일·인증·세션 관련 정보는 아예
 * 셀렉트하지 않는다. `coupleId`는 항상 호출부가 "내 계정의" couple_id에서만 얻어 오므로(클라
 * 이언트가 임의의 커플 id를 지정할 방법이 없다), 다른 커플의 정보를 조회할 길이 구조적으로
 * 없다.
 */
export async function findPartnerInCouple(
  db: Queryable,
  coupleId: string,
  selfUserId: string,
): Promise<PartnerInfo | null> {
  const { rows } = await db.query<PartnerInfo>(
    'SELECT nickname, avatar_emoji FROM users WHERE couple_id = $1 AND id <> $2',
    [coupleId, selfUserId],
  );
  return rows[0] ?? null;
}

/** 연애 시작일은 선택 항목이며 연결일(connected_at)과 별도로 관리한다(0010 §8과 동일한 규칙). */
export async function updateRelationshipStartDate(
  db: Queryable,
  coupleId: string,
  relationshipStartDate: string | null,
): Promise<CoupleRow> {
  const { rows } = await db.query<CoupleRow>(
    'UPDATE couples SET relationship_start_date = $2 WHERE id = $1 RETURNING *',
    [coupleId, relationshipStartDate],
  );
  const row = rows[0];
  if (!row) throw new Error('커플을 찾을 수 없습니다.');
  return row;
}
