import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { resetTables, getTestPool } from '../helpers/db';
import {
  buildTestAppWithAuth,
  TEST_ALLOWED_ORIGIN,
  TEST_TOKEN_ENCRYPTION_KEY,
  extractCookie,
} from '../helpers/app';
import { createStubAuthPort } from '../../src/cognito/stubAuthPort';
import { createUser, findUserById, findUserByEmail } from '../../src/repositories/usersRepository';
import { findValidSession } from '../../src/repositories/sessionsRepository';
import {
  createPasswordResetRecovery,
  applyRecoveryConfirmation,
  type ApplyRecoveryResult,
} from '../../src/repositories/authRecoveryRepository';
import { runCleanupPendingAuthOnce } from '../../src/jobs/cleanupPendingAuth';
import { login, confirmForgotPassword, AuthConflictError } from '../../src/services/authService';

/**
 * 특정 SQL 문(matchText가 포함된 것)에 대해서만 매번 재시도 가능한(40001) 실패를 주입하는
 * pool 대체물 — "실제 서비스 경로"를 그대로 타면서, 그 경로 안의 특정 한 문장만 독립적으로
 * 실패시키기 위한 의존성 대체다(계획 요구사항 4: 어렵다는 이유로 생략하지 않는다).
 */
function wrapPoolFailingOn(pool: Pool, matchText: string): Pool {
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (...args: unknown[]) => {
          const text = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string })?.text;
          if (text?.includes(matchText)) {
            const err = Object.assign(new Error('simulated retryable failure'), { code: '40001' });
            return Promise.reject(err);
          }
          return (target.query as (...a: unknown[]) => unknown)(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Pool;
}

describe('password reset recovery — the 6 required real-path scenarios', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('1) an already-confirmed orphan recovery blocks the first login once (409), then succeeds on retry', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'scenario1@example.com';
    authPort.seedConfirmedUser(email, 'NewPassw0rd1!');

    // 사용자 행 없이 recovery를 먼저 confirmed로 만든다(§3-3) — 실제 T0 + T1 함수를 그대로 쓴다.
    const recovery = await createPasswordResetRecovery(pool, email);
    const applied: ApplyRecoveryResult = await applyRecoveryConfirmation(
      pool,
      recovery.id,
      'confirmed',
    );
    expect(applied.status).toBe('recorded-no-user');

    // 첫 로그인 시도 — 409로 거부되고, 세션이 생기지 않아야 한다(예전 버그: 여기서 ROLLBACK돼
    // recovery 확정 자체가 사라졌었다).
    await expect(
      login(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, email, 'NewPassw0rd1!', null),
    ).rejects.toBeInstanceOf(AuthConflictError);

    const user = await findUserByEmail(pool, email);
    expect(user).not.toBeNull();
    expect(user!.auth_version).toBe(1); // 사용자 생성 + 버전 인상이 실제로 COMMIT돼 남아 있다

    const { rows: recoveryRows } = await pool.query<{ target_auth_version: number | null }>(
      'SELECT target_auth_version FROM password_reset_recoveries WHERE id = $1',
      [recovery.id],
    );
    expect(recoveryRows[0]?.target_auth_version).toBe(1);

    const { rows: sessionCountRows } = await pool.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM sessions WHERE user_id = $1',
      [user!.id],
    );
    expect(sessionCountRows[0]?.c).toBe(0); // 세션은 안 만들어졌다

    // 재로그인 — 성공해야 하고, 새 세션의 created_with_auth_version이 최신 버전(1)이어야 한다.
    const result = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'NewPassw0rd1!',
      null,
    );
    const session = await findValidSession(pool, result.sessionId);
    expect(session?.created_with_auth_version).toBe(1);
  });

  it('2) T1 (version bump) commits independently of T2 (session cleanup); access is blocked before T2 even finishes', async () => {
    const pool = await getTestPool();
    const { app, authPort } = await buildTestAppWithAuth();
    const email = 'scenario2@example.com';
    authPort.seedConfirmedUser(email, 'OldPassw0rd1!');

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ALLOWED_ORIGIN)
      .send({ email, password: 'OldPassw0rd1!' })
      .expect(200);
    const cookie = extractCookie(loginRes);

    const user = await findUserByEmail(pool, email);
    expect(user).not.toBeNull();

    // T1을 실제 함수로 먼저 실행해 COMMIT되게 한다.
    const recovery = await createPasswordResetRecovery(pool, email);
    const applied = await applyRecoveryConfirmation(pool, recovery.id, 'confirmed');
    expect(applied.status).toBe('applied');

    // 이 시점 T2(세션 정리)는 아직 시도조차 안 했다 — 그런데도 기존 세션 쿠키로 보호된 라우트는
    // 이미 401이어야 한다(§3-2 핵심 주장).
    await request(app).get('/api/profile').set('Cookie', cookie).expect(401);

    // 이제 두 번째 커넥션으로 그 사용자의 세션 행을 잠가 T2가 실제로 지연되게 만든다.
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM sessions WHERE user_id = $1 FOR UPDATE', [user!.id]);

    let t2Done = false;
    const { revokeSessionsForRecovery } =
      await import('../../src/repositories/authRecoveryRepository');
    const t2Promise = revokeSessionsForRecovery(
      pool,
      (applied as { userId: string }).userId,
      (applied as { targetAuthVersion: number }).targetAuthVersion,
      recovery.id,
    ).then(() => {
      t2Done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t2Done).toBe(false); // blocker가 쥔 잠금 때문에 아직 끝나지 않았다

    // 잠금이 풀린 뒤에야 T2가 끝난다 — 그래도 접근 차단 판정 자체는 이미 위에서 확인이 끝났다.
    await blocker.query('ROLLBACK');
    blocker.release();
    await t2Promise;
    expect(t2Done).toBe(true);

    const { rows } = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sessions WHERE user_id = $1',
      [user!.id],
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
  });

  it('3) failing to record a rejected code (even after retries) leaves the session untouched now, but cleanup later force-logs-out the legitimate user (documented cost, §3-7)', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'scenario3@example.com';
    authPort.seedConfirmedUser(email, 'CorrectPassw0rd1!');
    await authPort.forgotPassword(email); // resetCode 세팅

    const loginResult = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'CorrectPassw0rd1!',
      null,
    );

    // "outcome = 'failed'" UPDATE만 독립적으로, 재시도까지 실패하게 만든다.
    const failingPool = wrapPoolFailingOn(pool, "outcome = 'failed'");

    const outcome = await confirmForgotPassword(
      failingPool,
      authPort,
      email,
      'WRONG-CODE',
      'Another1Pw!',
    );
    expect(outcome).toBe('rejected'); // 서비스 응답 자체는 기록 실패와 무관하게 정상적으로 거절을 알린다

    // 지금 이 순간까지는 세션이 전혀 영향받지 않는다 — 틀린 코드만으로 아무도 차단되지 않는다.
    const sessionNow = await findValidSession(pool, loginResult.sessionId);
    expect(sessionNow).not.toBeNull();

    const { rows } = await pool.query<{ id: string; outcome: string }>(
      `SELECT id, outcome FROM password_reset_recoveries WHERE email = $1 ORDER BY requested_at DESC LIMIT 1`,
      [email],
    );
    expect(rows[0]?.outcome).toBe('pending'); // 기록 UPDATE가 실제로 실패했다는 증거

    // 2분 경과 상태를 직접 재현한다(실제로 기다리지 않는다).
    await pool.query(
      `UPDATE password_reset_recoveries SET requested_at = clock_timestamp() - interval '10 minutes' WHERE id = $1`,
      [rows[0]!.id],
    );

    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

    const { rows: after } = await pool.query<{
      outcome: string;
      target_auth_version: number | null;
    }>(`SELECT outcome, target_auth_version FROM password_reset_recoveries WHERE id = $1`, [
      rows[0]!.id,
    ]);
    expect(after[0]?.outcome).toBe('assumed'); // confirmed와 구분되는 값으로 남는다
    expect(after[0]?.target_auth_version).not.toBeNull();

    const sessionAfter = await findValidSession(pool, loginResult.sessionId);
    expect(sessionAfter).toBeNull(); // 정당한 사용자가 강제 로그아웃됨 — §3-7에 문서화한 대가
  });

  it('4) a reset that starts before the user exists does not block a concurrent first login; cleanup later finds the new user', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'scenario4@example.com';
    authPort.seedConfirmedUser(email, 'Passw0rd1!');
    await authPort.forgotPassword(email);

    // T0만 실행해 pending 상태로 남긴다(Cognito 응답 전 상태 재현).
    const recovery = await createPasswordResetRecovery(pool, email);
    expect(recovery.outcome).toBe('pending');
    expect(recovery.user_id).toBeNull();

    // 이 시점 사용자 행이 없다 — 첫 로그인이 막히지 않아야 한다.
    const loginResult = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'Passw0rd1!',
      null,
    );
    const user = await findUserByEmail(pool, email);
    expect(user!.auth_version).toBe(0);
    expect(await findValidSession(pool, loginResult.sessionId)).not.toBeNull();

    // recovery가 stale pending으로 남아 있다고 재현하고 정리 루틴을 실행한다.
    await pool.query(
      `UPDATE password_reset_recoveries SET requested_at = clock_timestamp() - interval '10 minutes' WHERE id = $1`,
      [recovery.id],
    );
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

    const { rows } = await pool.query<{
      outcome: string;
      target_auth_version: number | null;
      user_id: string | null;
    }>(
      `SELECT outcome, target_auth_version, user_id FROM password_reset_recoveries WHERE id = $1`,
      [recovery.id],
    );
    expect(rows[0]?.outcome).toBe('assumed');
    expect(rows[0]?.target_auth_version).toBe(1);
    expect(rows[0]?.user_id).toBe(user!.id); // 방금 생긴 사용자를 스스로 찾아냈다

    expect(await findValidSession(pool, loginResult.sessionId)).toBeNull(); // 앞서 만든 세션은 무효화됨
  });

  it('5) concurrent applyRecoveryConfirmation calls on the same recovery bump the version exactly once', async () => {
    const pool = await getTestPool();
    const email = 'scenario5@example.com';
    const user = await createUser(pool, email);
    const recovery = await createPasswordResetRecovery(pool, email);
    await pool.query(
      `UPDATE password_reset_recoveries SET outcome = 'confirmed', outcome_recorded_at = clock_timestamp() WHERE id = $1`,
      [recovery.id],
    );

    const [resultA, resultB] = await Promise.all([
      applyRecoveryConfirmation(pool, recovery.id, 'confirmed'),
      applyRecoveryConfirmation(pool, recovery.id, 'confirmed'),
    ]);
    const results = [resultA, resultB];
    expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'already-applied')).toHaveLength(1);

    const updatedUser = await findUserById(pool, user.id);
    expect(updatedUser!.auth_version).toBe(1); // 정확히 한 번만 올랐다
  });

  it('6) re-running a fully completed recovery via cleanup is a no-op and does not touch a fresh post-reset session', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'scenario6@example.com';
    authPort.seedConfirmedUser(email, 'OldPassw0rd1!');

    await login(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, email, 'OldPassw0rd1!', null); // 사용자 행 생성

    await authPort.forgotPassword(email);
    const outcome = await confirmForgotPassword(pool, authPort, email, '222222', 'NewPassw0rd2!');
    expect(outcome).toBe('confirmed-sessions-revoked'); // T1·T2 모두 이 요청 안에서 끝남

    const freshLogin = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'NewPassw0rd2!',
      null,
    );
    const userBefore = await findUserByEmail(pool, email);
    expect(userBefore!.auth_version).toBe(1);

    // 이미 끝난 recovery를 정리 루틴이 다시 훑어도 아무 것도 바뀌지 않아야 한다.
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

    const userAfter = await findUserByEmail(pool, email);
    expect(userAfter!.auth_version).toBe(1); // 다시 오르지 않음

    const freshSession = await findValidSession(pool, freshLogin.sessionId);
    expect(freshSession).not.toBeNull(); // 여전히 유효
  });
});
