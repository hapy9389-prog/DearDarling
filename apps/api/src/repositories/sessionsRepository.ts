import type { Pool, PoolClient } from 'pg';

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  user_agent: string | null;
  created_with_auth_version: number;
  cognito_refresh_token_encrypted: Buffer | null;
  cognito_cleanup_pending: boolean;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * `createdWithAuthVersion`은 세션을 만드는 트랜잭션이 사용자 행을 잠근 뒤 읽은 "지금의"
 * auth_version이어야 한다(계획 §3-1) — 이후 모든 접근 판단(findValidSession)이 이 값을 쓴다.
 * `cognitoRefreshTokenEncrypted`는 로그아웃·재설정 뒤 그 세션의 Cognito 쪽 토큰을 개별
 * RevokeToken으로 폐기하기 위해 저장한다(암호화 키가 없으면 null — 폐기 위생 관리만 못 한다).
 */
export async function createSession(
  db: Queryable,
  userId: string,
  expiresAt: Date,
  userAgent: string | null,
  createdWithAuthVersion: number,
  cognitoRefreshTokenEncrypted: Buffer | null,
): Promise<SessionRow> {
  const { rows } = await db.query<SessionRow>(
    `INSERT INTO sessions (user_id, expires_at, user_agent, created_with_auth_version, cognito_refresh_token_encrypted)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, expiresAt, userAgent, createdWithAuthVersion, cognitoRefreshTokenEncrypted],
  );
  const row = rows[0];
  if (!row) throw new Error('세션 생성에 실패했습니다.');
  return row;
}

/**
 * 접근 차단의 기준 — 매 요청마다 이 조회로만 유효성을 판단한다. `created_with_auth_version =
 * users.auth_version` 비교가 핵심(계획 §3-2): 재설정·전체 로그아웃이 auth_version을 올리는
 * 트랜잭션이 COMMIT되는 순간, 그 사용자의 모든 기존 세션은 이 조회에서 다음 요청부터 즉시
 * 탈락한다 — 개별 세션 행의 revoked_at을 실제로 채우는 정리 작업(비동기, 지연될 수 있음)이
 * 끝났는지와 무관하다. 만료 판정은 DB의 현재 시각(clock_timestamp()) 기준.
 */
export async function findValidSession(
  db: Queryable,
  sessionId: string,
): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT sessions.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = $1
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > clock_timestamp()
       AND sessions.created_with_auth_version = users.auth_version`,
    [sessionId],
  );
  return rows[0] ?? null;
}

/**
 * 로컬 무효화(revoked_at)와 Cognito 쪽 정리 예약(cognito_cleanup_pending)을 한 UPDATE 문으로
 * 원자적으로 처리한다 — Cognito를 호출하지 않으므로(이 함수 자체는 순수 로컬 작업) 외부 호출
 * 실패가 로컬 로그아웃을 취소할 여지 자체가 없다. `revoked_at IS NULL` 가드 덕분에 같은 세션에
 * 반복 호출해도 두 번째 이후는 그냥 아무 일도 하지 않는다(idempotent).
 */
export async function revokeSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET revoked_at = clock_timestamp(), cognito_cleanup_pending = true
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

export interface SessionForCleanup {
  id: string;
  user_id: string;
  cognito_refresh_token_encrypted: Buffer | null;
}

/** 3-6의 4번 단계 대상 — Cognito 쪽 정리(RevokeToken)가 아직 안 끝난 세션. */
export async function listSessionsPendingCognitoCleanup(
  pool: Pool,
  limit = 100,
): Promise<SessionForCleanup[]> {
  const { rows } = await pool.query<SessionForCleanup>(
    `SELECT id, user_id, cognito_refresh_token_encrypted
     FROM sessions WHERE cognito_cleanup_pending = true LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * 저장해 둔 암호문도 함께 지운다 — 더 필요 없는 민감정보를 계속 들고 있지 않기 위해서이자,
 * "정리 대기 중이었던 적 없음"(cleanup_pending=false, 토큰도 없음)과 "정리가 끝남"
 * (cleanup_pending=false, 예전엔 토큰이 있었음)을 이 컬럼 하나로 구분하기 위해서다 —
 * `recoverRevokedSessionsMissingCleanupFlag`가 바로 이 구분에 의존한다.
 */
export async function markSessionCognitoCleanupDone(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE sessions SET cognito_cleanup_pending = false, cognito_refresh_token_encrypted = NULL
     WHERE id = $1`,
    [sessionId],
  );
}

/**
 * 자가 치유 단계 — 이미 로그아웃(revoked_at 있음)됐지만 `cognito_cleanup_pending`이 한 번도
 * 켜지지 않은 채 남은 세션을 정리 대상으로 되돌린다. 과거 로그아웃 경로가 이 플래그를 빠뜨렸던
 * 흔적(또는 앞으로 비슷한 버그가 생기는 경우)을 위한 것이다. 이미 정리가 끝난 세션은
 * `markSessionCognitoCleanupDone`이 암호문을 지워 두므로 `cognito_refresh_token_encrypted
 * IS NOT NULL` 조건에 걸리지 않는다 — 몇 번을 다시 실행해도 안전(idempotent)하고, 이미 처리된
 * 세션이나 폐기할 토큰이 애초에 없던 세션은 절대 다시 건드리지 않는다. 반환값은 복구한 행 수.
 */
export async function recoverRevokedSessionsMissingCleanupFlag(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE sessions SET cognito_cleanup_pending = true
     WHERE revoked_at IS NOT NULL
       AND cognito_cleanup_pending = false
       AND cognito_refresh_token_encrypted IS NOT NULL`,
  );
  return result.rowCount ?? 0;
}
