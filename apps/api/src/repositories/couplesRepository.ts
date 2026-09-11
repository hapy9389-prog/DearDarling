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
