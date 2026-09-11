import type { Pool } from 'pg';
import { normalizeEmail } from '../domain/auth';
import { withRetry } from '../db/retry';
import { findUserByEmail } from '../repositories/usersRepository';
import { createSession, revokeSession } from '../repositories/sessionsRepository';
import {
  createPasswordResetRecovery,
  markRecoveryFailed,
  markRecoveryUnknown,
  applyRecoveryConfirmation,
  revokeSessionsForRecovery,
  drainUnappliedRecoveriesForNewUser,
} from '../repositories/authRecoveryRepository';
import { AuthPortTimeoutError, type CognitoAuthPort } from '../cognito/authPort';
import { encryptToken } from '../cognito/tokenCipher';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

/** 로그인 시작 시점에 캡처한 버전과, 사용자 행 잠금 뒤 다시 읽은 버전이 달라 세션을 내주지
 * 않은 경우(계획 §3-1, §3-5) — 라우트는 이걸 409로 매핑한다. */
export class AuthConflictError extends Error {
  constructor() {
    super('로그인 처리 중 다른 인증 변경이 발생했습니다. 다시 로그인해 주세요.');
    this.name = 'AuthConflictError';
  }
}

export interface LoginSuccess {
  sessionId: string;
  sessionExpiresAt: Date;
}

/**
 * T-login(계획 §3-1). Cognito 왕복(느림, 실패 시 authPort가 AuthPortRejectedError를 던진다)은
 * DB 트랜잭션 밖에서 먼저 끝낸다. 그 다음 트랜잭션 안에서: 사용자 행을 찾거나 만들고(cognito_sub
 * 기준 자기 치유, 이메일만으로 기존 행에 자동 연결하지 않는다), users 행을 FOR UPDATE로 잠근 뒤
 * (공통 잠금 순서: users 먼저) 신규 생성이면 미적용 복구를 소진한다(드물게 있으면 그대로
 * COMMIT하고 이 요청은 세션 없이 AuthConflictError로 끝낸다 — 재시도하면 성공한다). 그 외엔
 * 캡처해 둔 시작 시점 버전과 지금 버전을 비교해 다르면(예: 로그인 도중 전체 로그아웃/재설정이
 * 끼어듦) 세션을 만들지 않는다.
 */
export async function login(
  pool: Pool,
  authPort: CognitoAuthPort,
  tokenEncryptionKey: Buffer | undefined,
  emailRaw: string,
  password: string,
  userAgent: string | null,
): Promise<LoginSuccess> {
  const email = normalizeEmail(emailRaw);
  const existing = await findUserByEmail(pool, email);
  const versionAtStart = existing?.auth_version ?? 0;

  const authResult = await authPort.initiateAuth(email, password);
  const claims = await authPort.verifyIdToken(authResult.idToken);
  // accessToken은 의도적으로 저장하지 않는다 — 이 서버의 접근 차단은 우리 세션 쿠키가 유일한
  // 기준이고(auth_version 비교), Cognito 쪽 정리는 세션별로 저장하는 refreshToken의 개별
  // RevokeToken으로 충분하다(authPort.ts 참고, GlobalSignOut을 위한 access token 보관 불필요).
  const encryptedRefreshToken = tokenEncryptionKey
    ? encryptToken(authResult.refreshToken, tokenEncryptionKey)
    : null;

  return withRetry(async () => {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      const { rows: insertRows } = await client.query<{ id: string }>(
        `INSERT INTO users (email, cognito_sub) VALUES ($1, $2)
         ON CONFLICT (cognito_sub) DO NOTHING RETURNING id`,
        [email, claims.sub],
      );
      let userId = insertRows[0]?.id;
      const isNew = !!userId;
      if (!userId) {
        const { rows } = await client.query<{ id: string }>(
          'SELECT id FROM users WHERE cognito_sub = $1',
          [claims.sub],
        );
        userId = rows[0]?.id;
      }
      if (!userId) {
        // 같은 이메일의 기존 행이 있어 UNIQUE 위반 등으로 실패한 경우 — 자동으로 그 행에
        // 연결하지 않는다. 사람이 확인해야 하는 상황이므로 일반 오류로 그대로 던진다.
        throw new Error(
          '사용자 계정을 확정할 수 없습니다(이메일 충돌 가능성) — 운영자 확인이 필요합니다.',
        );
      }

      const { rows: versionRows } = await client.query<{ auth_version: number }>(
        'SELECT auth_version FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const currentVersion = versionRows[0]!.auth_version;

      if (isNew) {
        const drain = await drainUnappliedRecoveriesForNewUser(
          client,
          userId,
          email,
          currentVersion,
        );
        if (drain.applied) {
          await client.query('COMMIT');
          committed = true;
          throw new AuthConflictError();
        }
      }

      if (currentVersion !== versionAtStart) {
        await client.query('ROLLBACK');
        committed = true; // 롤백도 "이 트랜잭션을 이미 마무리했다"는 의미로 재롤백을 막는다.
        throw new AuthConflictError();
      }

      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const session = await createSession(
        client,
        userId,
        expiresAt,
        userAgent,
        currentVersion,
        encryptedRefreshToken,
      );
      await client.query('COMMIT');
      committed = true;
      return { sessionId: session.id, sessionExpiresAt: session.expires_at };
    } catch (err) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
}

export async function signUp(
  authPort: CognitoAuthPort,
  emailRaw: string,
  password: string,
): Promise<void> {
  await authPort.signUp(normalizeEmail(emailRaw), password);
  // 로컬 DB에는 아무것도 쓰지 않는다 — 사용자 행은 첫 로그인 시점에만 생긴다(자기 치유).
}

export async function confirmSignUp(
  authPort: CognitoAuthPort,
  emailRaw: string,
  code: string,
): Promise<void> {
  await authPort.confirmSignUp(normalizeEmail(emailRaw), code);
}

export async function resendConfirmationCode(
  authPort: CognitoAuthPort,
  emailRaw: string,
): Promise<void> {
  await authPort.resendConfirmationCode(normalizeEmail(emailRaw));
}

/** 계정 존재 여부를 응답으로 흘리지 않는다 — Cognito가 무엇을 답하든 호출부는 항상 같은 응답을 보낸다. */
export async function requestForgotPassword(
  authPort: CognitoAuthPort,
  emailRaw: string,
): Promise<void> {
  try {
    await authPort.forgotPassword(normalizeEmail(emailRaw));
  } catch {
    // 존재하지 않는 계정 등 — 그대로 삼킨다.
  }
}

export type ConfirmForgotPasswordOutcome =
  | 'confirmed-sessions-revoked'
  | 'confirmed-cleanup-pending'
  | 'confirmed-local-pending'
  | 'rejected'
  | 'unknown';

/**
 * 계획 §3-4. T0(recovery 생성, Cognito 호출 전) → Cognito 호출 → 결과에 따라 T1(버전 확정,
 * applyRecoveryConfirmation)과 T2(세션 정리, revokeSessionsForRecovery)를 순서대로, 별개
 * 트랜잭션으로 시도한다. T1은 반드시 독립적으로 남고 T2만 재시도 대상이 된다(계획 요구사항 2).
 */
export async function confirmForgotPassword(
  pool: Pool,
  authPort: CognitoAuthPort,
  emailRaw: string,
  code: string,
  newPassword: string,
): Promise<ConfirmForgotPasswordOutcome> {
  const email = normalizeEmail(emailRaw);
  const recovery = await createPasswordResetRecovery(pool, email); // T0

  let cognitoOutcome: 'confirmed' | 'rejected' | 'unknown';
  try {
    await authPort.confirmForgotPassword(email, code, newPassword);
    cognitoOutcome = 'confirmed';
  } catch (err) {
    cognitoOutcome = err instanceof AuthPortTimeoutError ? 'unknown' : 'rejected';
  }

  if (cognitoOutcome === 'rejected') {
    // 이 기록 UPDATE 자체가 재시도까지 실패해도(드묾) Cognito가 실제로 거절했다는 사실은
    // 그대로 응답한다 — 로컬 기록 실패가 정확한 거절 응답을 막지 않는다. recovery는 'pending'
    // 으로 남고, 3-6의 정리 루틴이 나중에 이 이중 장애를 이어받는다(§3-7에 대가를 명시).
    await withRetry(() => markRecoveryFailed(pool, recovery.id)).catch(() => {});
    return 'rejected';
  }
  if (cognitoOutcome === 'unknown') {
    await withRetry(() => markRecoveryUnknown(pool, recovery.id)).catch(() => {});
    return 'unknown';
  }

  let applyResult;
  try {
    applyResult = await withRetry(() => applyRecoveryConfirmation(pool, recovery.id, 'confirmed')); // T1
  } catch {
    // T1 자체가 재시도까지 실패했다 — Cognito는 이미 비밀번호 변경을 확인했다는 사실은 T0로
    // 이미 durable하게 기록돼 있다(recovery는 outcome='pending'인 채로 남는다). 여기서 일반
    // 500으로 끝내지 않는다: "확정됐지만 로컬 차단은 아직 미완료"라는 상태를 그대로 알리고,
    // 3-6의 정리 루틴이 stale-pending 경로로 이어받는다.
    return 'confirmed-local-pending';
  }
  if (applyResult.status !== 'applied') {
    // 사용자 없음(나중에 로그인/정리 루틴이 처리) 또는 이미 처리됨(동시 요청 등, 드묾).
    return 'confirmed-cleanup-pending';
  }
  try {
    await withRetry(() =>
      revokeSessionsForRecovery(
        pool,
        applyResult.userId,
        applyResult.targetAuthVersion,
        recovery.id,
      ),
    ); // T2
    return 'confirmed-sessions-revoked';
  } catch {
    // T2 재시도까지 실패해도 요청을 실패로 끝내지 않는다 — 접근 차단(T1)은 이미 COMMIT됐고,
    // 3-6의 정리 루틴이 세션 행 정리를 이어받는다.
    return 'confirmed-cleanup-pending';
  }
}

/**
 * 계획 §3-8. 로컬 무효화와 Cognito 쪽 정리 예약(cognito_cleanup_pending)을 하나의 UPDATE로
 * 원자적으로 처리한다(revokeSession) — 이 함수는 Cognito를 호출하지 않으므로 외부 호출 실패가
 * 로컬 로그아웃을 취소할 여지 자체가 없다. 반복 호출해도 안전하다(revoked_at IS NULL 가드).
 */
export async function logout(pool: Pool, sessionId: string): Promise<void> {
  await revokeSession(pool, sessionId);
}

/**
 * 계획 §3-8. 로컬 무효화(auth_version 증가 + 그 시점 세션 전체 revoked_at)는 Cognito 호출과
 * 무관하게 먼저·항상 실행된다 — 이 흐름은 애초에 외부 호출 성공에 의존하지 않으므로 §3-4 같은
 * 사전 기록(recovery row)이 필요 없다. Cognito 쪽 정리는 GlobalSignOut을 쓰지 않는다 — access
 * token을 세션에 보관하지 않으므로(authPort.ts 참고), 여기서 무효화되는 각 세션이 로그인
 * 시점에 저장해 둔 refresh token을 `cognito_cleanup_pending=true`로 표시해 두면 3-6의 정리
 * 루틴이 그 각각에 개별 RevokeToken을 시도한다. **이 보장 범위는 "우리 서버가 저장·관리하는
 * 대상 refresh token들"로 한정된다** — 예를 들어 암호화 키가 없어 애초에 저장되지 못한 세션의
 * 토큰, 또는 이 서버를 거치지 않고 발급된 Cognito 토큰(있다면)은 이 경로로 폐기되지 않는다.
 * 접근 차단 자체(우리 세션 쿠키 기준)는 이런 경우에도 auth_version 비교로 항상 보장된다 —
 * 영향을 받는 건 Cognito 쪽 위생 정리 범위뿐이다.
 */
export async function logoutAll(pool: Pool, userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ auth_version: number }>(
      'SELECT auth_version FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const user = rows[0];
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    const newVersion = user.auth_version + 1;
    await client.query('UPDATE users SET auth_version = $2 WHERE id = $1', [userId, newVersion]);
    await client.query(
      `UPDATE sessions SET revoked_at = clock_timestamp(), cognito_cleanup_pending = true
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
