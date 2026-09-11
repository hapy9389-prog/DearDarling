import type { Pool, PoolClient } from 'pg';

export interface ConsentEventRow {
  id: string;
  user_id: string;
  granted: boolean;
  version: number;
  changed_at: Date;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * 현재값(users.analysis_consent) 갱신과 이력(consent_events) 삽입 두 단계 중 하나만
 * 실행되는 순간을 만들지 않도록, 이미 열려 있는 트랜잭션의 client에서만 호출한다.
 * BEGIN/COMMIT/ROLLBACK은 호출하는 쪽(recordConsentChange)이 관리한다.
 *
 * `nextVersion`은 호출하는 쪽이 사용자 행을 `FOR UPDATE`로 잠근 뒤에 계산해 넘겨야 한다 —
 * 순서 보장의 핵심은 이 값이지 `changed_at`이 아니다. `changed_at`은 트랜잭션 시작 시각을
 * 돌려주는 now() 대신 실제 실행 시점을 반영하는 `clock_timestamp()`로 기록한다(참고용
 * 정확도를 위한 것일 뿐, 정렬 기준은 여전히 version이다).
 */
export async function applyConsentChangeInTransaction(
  client: PoolClient,
  userId: string,
  granted: boolean,
  nextVersion: number,
): Promise<ConsentEventRow> {
  await client.query('UPDATE users SET analysis_consent = $2, consent_version = $3 WHERE id = $1', [
    userId,
    granted,
    nextVersion,
  ]);
  const { rows } = await client.query<ConsentEventRow>(
    `INSERT INTO consent_events (user_id, granted, version, changed_at)
     VALUES ($1, $2, $3, clock_timestamp())
     RETURNING *`,
    [userId, granted, nextVersion],
  );
  const row = rows[0];
  if (!row) throw new Error('동의 이력 기록에 실패했습니다.');
  return row;
}

/**
 * 동의는 단일 값이 아니라 이력으로 남긴다(계획 §4) — 나중에 "두 사람이 모두 동의한 기간"만
 * 분석 대상으로 판단하려면 이 이력이 필요하다. users.analysis_consent(현재값)와
 * consent_events(이력) 갱신을 같은 커넥션의 단일 트랜잭션으로 처리해, 이력 저장이 실패하면
 * 현재값 갱신도 함께 롤백된다.
 *
 * 사용자 행을 `FOR UPDATE`로 잠근 뒤 그 사용자의 다음 버전 번호를 계산해서 현재값·이력에
 * 같은 트랜잭션으로 함께 기록한다 — 같은 사용자에 대한 동시 요청은 이 잠금으로 직렬화되고,
 * "현재값이 마지막(최고 버전) 이력 행과 항상 일치한다"가 요청이 시작된 순서가 아니라
 * 실제로 처리(잠금 획득)된 순서를 기준으로 보장된다.
 */
export async function recordConsentChange(
  pool: Pool,
  userId: string,
  granted: boolean,
): Promise<ConsentEventRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: userRows } = await client.query<{ id: string; consent_version: number }>(
      'SELECT id, consent_version FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const userRow = userRows[0];
    if (!userRow) throw new Error('사용자를 찾을 수 없습니다.');

    const nextVersion = userRow.consent_version + 1;
    const row = await applyConsentChangeInTransaction(client, userId, granted, nextVersion);

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listConsentHistory(
  db: Queryable,
  userId: string,
): Promise<ConsentEventRow[]> {
  const { rows } = await db.query<ConsentEventRow>(
    'SELECT * FROM consent_events WHERE user_id = $1 ORDER BY version ASC',
    [userId],
  );
  return rows;
}
