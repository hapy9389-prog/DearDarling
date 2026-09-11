import type { Pool, PoolClient } from 'pg';

export type RecoveryOutcome = 'pending' | 'confirmed' | 'failed' | 'unknown' | 'assumed';

export interface PasswordResetRecoveryRow {
  id: string;
  user_id: string | null;
  email: string;
  requested_at: Date;
  outcome: RecoveryOutcome;
  outcome_recorded_at: Date | null;
  target_auth_version: number | null;
  sessions_revoked_at: Date | null;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * T0 — Cognito를 부르기 "전"에 먼저, 항상 남긴다(계획 §3-4). user_id는 이 시점의 스냅샷일
 * 뿐이다 — 이후 모든 판단(applyRecoveryConfirmation)은 그때그때 email로 다시 조회하고,
 * 이 스냅샷을 신뢰하지 않는다. 비밀번호·인증 코드는 이 표를 포함해 어디에도 저장하지 않는다.
 */
export async function createPasswordResetRecovery(
  db: Queryable,
  email: string,
): Promise<PasswordResetRecoveryRow> {
  const { rows } = await db.query<PasswordResetRecoveryRow>(
    `INSERT INTO password_reset_recoveries (user_id, email)
     VALUES ((SELECT id FROM users WHERE email = $1), $1)
     RETURNING *`,
    [email],
  );
  const row = rows[0];
  if (!row) throw new Error('비밀번호 재설정 기록 생성에 실패했습니다.');
  return row;
}

/**
 * 케이스 A(확정적 거절). 이미 다른 실행이 outcome을 confirmed/assumed/failed로 결정해 뒀다면
 * 덮어쓰지 않는다 — 늦게 도착한 "거절" 응답이 이미 처리된(성공으로 확정된) 복구를 되돌리는 것을
 * 막기 위한 조건이다(계획 요구사항 3).
 */
export async function markRecoveryFailed(db: Queryable, recoveryId: string): Promise<void> {
  await db.query(
    `UPDATE password_reset_recoveries
     SET outcome = 'failed', outcome_recorded_at = clock_timestamp()
     WHERE id = $1 AND outcome IN ('pending', 'unknown')`,
    [recoveryId],
  );
}

/**
 * 케이스 C(응답을 받지 못함). 마찬가지로 이미 결정된 outcome은 덮어쓰지 않는다 — 늦게 도착한
 * "타임아웃" 판정이 이미 처리된 복구를 다시 unknown으로 되돌리지 않도록 한다(계획 요구사항 3).
 */
export async function markRecoveryUnknown(db: Queryable, recoveryId: string): Promise<void> {
  await db.query(
    `UPDATE password_reset_recoveries
     SET outcome = 'unknown', outcome_recorded_at = clock_timestamp()
     WHERE id = $1 AND outcome IN ('pending', 'unknown')`,
    [recoveryId],
  );
}

export type ApplyRecoveryResult =
  | { status: 'already-applied' }
  | { status: 'already-rejected' }
  | { status: 'recorded-no-user' }
  | { status: 'applied'; userId: string; targetAuthVersion: number };

/**
 * T1 — 사용자 행 유무와 무관하게, 정확히 한 번만 auth_version을 올린다(계획 §3-3).
 *
 * 잠금 순서: email로 users 행을 먼저 잠그고(있으면), 그다음 이 recovery 행을 잠근다 — 로그인의
 * "미적용 복구 소진"(drainUnappliedRecoveriesForNewUser)과 같은 순서라 두 트랜잭션 사이에
 * 교착상태가 나지 않는다. recoveryId만 갖고 email을 알아내려면 recovery 행을 먼저 읽어야 하므로,
 * 잠금 없는 조회(peek — email은 생성 후 바뀌지 않으므로 안전하다)로 email만 얻은 뒤
 * users→recovery 순서로 다시 잠근다(entryLinkService의 redeem과 같은 peek-then-lock 패턴).
 *
 * 조기 종료 조건은 "target_auth_version이 이미 채워졌다"(정말로 더 할 일이 없다) 또는
 * "outcome이 이미 'failed'다"(거절 확정 후에는 되돌리지 않는다) 뿐이다. outcome이 이미
 * confirmed/assumed인데 target_auth_version이 아직 NULL인 경우는 "결과는 확정됐지만 아직
 * 적용되지 않았다"는 뜻이므로 여기서 멈추지 않고 계속 진행해 지금 사용자가 있는지 다시 확인한다
 * — outcome만 보고 조기 종료하면, 나중에 사용자가 생겨도 이 복구가 영영 적용되지 못하는
 * 버그였다(계획 요구사항 2).
 */
export async function applyRecoveryConfirmation(
  pool: Pool,
  recoveryId: string,
  outcomeIfDeciding: 'confirmed' | 'assumed',
): Promise<ApplyRecoveryResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: peekRows } = await client.query<{ email: string }>(
      `SELECT email FROM password_reset_recoveries WHERE id = $1`,
      [recoveryId],
    );
    const email = peekRows[0]?.email;
    if (!email) throw new Error(`복구 기록을 찾을 수 없습니다: ${recoveryId}`);

    // 공통 잠금 순서: users 먼저(있으면). 사용자 행이 없으면 잠글 것 자체가 없다 — 그 경우
    // recovery 행 잠금만이 유일한 경합 지점이 되며, 그건 로그인의 미적용 복구 소진과 동일하다.
    const { rows: userRows } = await client.query<{ id: string; auth_version: number }>(
      `SELECT id, auth_version FROM users WHERE email = $1 FOR UPDATE`,
      [email],
    );
    const user = userRows[0];

    // 그다음 recovery 행 — peek 이후 다른 실행이 먼저 처리했을 수 있으니 잠근 뒤 재확인한다.
    const { rows: recoveryRows } = await client.query<PasswordResetRecoveryRow>(
      `SELECT * FROM password_reset_recoveries WHERE id = $1 FOR UPDATE`,
      [recoveryId],
    );
    const recovery = recoveryRows[0];
    if (!recovery) throw new Error(`복구 기록을 찾을 수 없습니다: ${recoveryId}`);

    if (recovery.target_auth_version !== null) {
      // 이미 적용됨(동시 호출 중 먼저 처리한 쪽이 있었다는 뜻) — 그래도 이전에 assumed로 남아
      // 있던 걸 나중에 도착한 진짜 확인(confirmed)으로 승격하는 것은 안전하다: 버전·세션 처리는
      // 다시 건드리지 않고 라벨만 정확해진다("확정" vs "추정"을 구분하라는 계획 요구사항 6).
      if (outcomeIfDeciding === 'confirmed' && recovery.outcome === 'assumed') {
        await client.query(
          `UPDATE password_reset_recoveries SET outcome = 'confirmed' WHERE id = $1`,
          [recoveryId],
        );
      }
      await client.query('COMMIT');
      return { status: 'already-applied' };
    }
    if (recovery.outcome === 'failed') {
      await client.query('COMMIT');
      return { status: 'already-rejected' };
    }

    // 여기부터는 target_auth_version이 없고 outcome도 'failed'가 아니다. 이미 confirmed/assumed로
    // 결정돼 있었다면(사용자가 없어 미뤄졌던 경우) 그 값을 그대로 쓴다 — 되돌리거나 덮어쓰지 않는다.
    const effectiveOutcome: 'confirmed' | 'assumed' =
      recovery.outcome === 'confirmed' || recovery.outcome === 'assumed'
        ? recovery.outcome
        : outcomeIfDeciding;

    if (!user) {
      await client.query(
        `UPDATE password_reset_recoveries
         SET outcome = $2, outcome_recorded_at = COALESCE(outcome_recorded_at, clock_timestamp())
         WHERE id = $1`,
        [recoveryId, effectiveOutcome],
      );
      await client.query('COMMIT');
      // target_auth_version은 NULL로 남는다 — 결과는 확정됐지만 적용 대상(사용자 행)이 아직
      // 없다는 뜻. 무기한 대기해도 무해하다(계획 §3-3) — 사용자가 생기면(로그인) 또는 다음
      // 정리 주기가 다시 이 함수를 호출해 그때는 적용된다.
      return { status: 'recorded-no-user' };
    }

    const targetAuthVersion = user.auth_version + 1;
    await client.query(`UPDATE users SET auth_version = $2 WHERE id = $1`, [
      user.id,
      targetAuthVersion,
    ]);
    await client.query(
      `UPDATE password_reset_recoveries
       SET outcome = $2, outcome_recorded_at = COALESCE(outcome_recorded_at, clock_timestamp()),
           target_auth_version = $3, user_id = $4
       WHERE id = $1`,
      [recoveryId, effectiveOutcome, targetAuthVersion, user.id],
    );
    await client.query('COMMIT');
    // 접근 차단이 확정되는 시점은 이 COMMIT이다(계획 §3-2) — UPDATE 실행 자체가 아니다.
    return { status: 'applied', userId: user.id, targetAuthVersion };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * T2 — 접근 차단(T1의 COMMIT)과 독립된 후처리. 세션 행의 revoked_at을 채우고 Cognito 쪽 정리
 * 대상으로 표시한다. 실패해도 접근 차단 자체엔 영향이 없다(auth_version이 이미 올라갔으므로) —
 * 3-6의 정리 루틴이 재시도한다. `created_with_auth_version < targetAuthVersion` 조건은 재시도해도
 * 항상 같은 결과를 내는 멱등 조건이다.
 */
export async function revokeSessionsForRecovery(
  pool: Pool,
  userId: string,
  targetAuthVersion: number,
  recoveryId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE sessions SET revoked_at = clock_timestamp(), cognito_cleanup_pending = true
       WHERE user_id = $1 AND revoked_at IS NULL AND created_with_auth_version < $2`,
      [userId, targetAuthVersion],
    );
    await client.query(
      `UPDATE password_reset_recoveries SET sessions_revoked_at = clock_timestamp() WHERE id = $1`,
      [recoveryId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 로그인의 "미적용 복구 소진"(계획 §3-1) — 방금 처음 만든 사용자 행에 대해, 이미
 * confirmed/assumed로 확정됐지만 그때는 사용자가 없어 적용되지 못한 복구가 있는지 확인하고,
 * 있으면 전부 적용한다. 호출자가 이미 users 행을 FOR UPDATE로 잠근 같은 트랜잭션(client) 안에서
 * 호출해야 한다 — applyRecoveryConfirmation과 같은 공통 잠금 순서(users 먼저)를 지키기 위해서다.
 * 보통 0~1건이지만, 서로 다른 재설정 시도가 각각 confirmed/assumed로 끝나 여러 건이 쌓여 있을
 * 수도 있어 전부 순서대로(ascending id) 반영한다.
 */
export async function drainUnappliedRecoveriesForNewUser(
  client: PoolClient,
  userId: string,
  email: string,
  currentAuthVersion: number,
): Promise<{ applied: boolean; newVersion: number }> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM password_reset_recoveries
     WHERE email = $1 AND outcome IN ('confirmed', 'assumed') AND target_auth_version IS NULL
     ORDER BY id FOR UPDATE`,
    [email],
  );
  if (rows.length === 0) return { applied: false, newVersion: currentAuthVersion };

  let version = currentAuthVersion;
  for (const row of rows) {
    version += 1;
    await client.query(
      `UPDATE password_reset_recoveries
       SET target_auth_version = $2, user_id = $3, sessions_revoked_at = clock_timestamp()
       WHERE id = $1`,
      [row.id, version, userId],
    );
  }
  await client.query(`UPDATE users SET auth_version = $2 WHERE id = $1`, [userId, version]);
  return { applied: true, newVersion: version };
}

/** 3-6의 1·3번 단계 대상 조회 — 재적용이 필요할 수 있는 복구 행. */
export async function listRecoveriesNeedingVersionApplication(
  pool: Pool,
  limit = 100,
): Promise<PasswordResetRecoveryRow[]> {
  const { rows } = await pool.query<PasswordResetRecoveryRow>(
    `SELECT * FROM password_reset_recoveries
     WHERE outcome IN ('confirmed', 'assumed') AND target_auth_version IS NULL
     LIMIT $1`,
    [limit],
  );
  return rows;
}

/** 3-6의 2번 단계 대상 — 버전은 이미 올랐지만 세션 정리(T2)가 아직 안 끝난 복구 행. */
export async function listRecoveriesNeedingSessionCleanup(
  pool: Pool,
  limit = 100,
): Promise<PasswordResetRecoveryRow[]> {
  const { rows } = await pool.query<PasswordResetRecoveryRow>(
    `SELECT * FROM password_reset_recoveries
     WHERE outcome IN ('confirmed', 'assumed') AND target_auth_version IS NOT NULL
       AND sessions_revoked_at IS NULL
     LIMIT $1`,
    [limit],
  );
  return rows;
}

/** 3-6의 3번 단계 대상 — 응답을 못 받았거나(unknown), 응답을 받은 직후 죽은 것으로 보이는(stale pending) 행. */
export async function listStaleUnresolvedRecoveries(
  pool: Pool,
  staleAfterMs: number,
  limit = 100,
): Promise<PasswordResetRecoveryRow[]> {
  const { rows } = await pool.query<PasswordResetRecoveryRow>(
    `SELECT * FROM password_reset_recoveries
     WHERE outcome = 'unknown'
        OR (outcome = 'pending' AND requested_at < clock_timestamp() - ($1 || ' milliseconds')::interval)
     LIMIT $2`,
    [staleAfterMs, limit],
  );
  return rows;
}
