import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestPool, resetTables } from '../helpers/db';
import { createStubAuthPort } from '../../src/cognito/stubAuthPort';
import { login, logout, logoutAll } from '../../src/services/authService';
import { runCleanupPendingAuthOnce } from '../../src/jobs/cleanupPendingAuth';
import { findUserByEmail } from '../../src/repositories/usersRepository';
import { findValidSession } from '../../src/repositories/sessionsRepository';
import { TEST_TOKEN_ENCRYPTION_KEY } from '../helpers/app';

async function loginAndGetSessionRow(
  pool: Awaited<ReturnType<typeof getTestPool>>,
  authPort: ReturnType<typeof createStubAuthPort>,
  email: string,
  password: string,
  key: Buffer | undefined,
) {
  const result = await login(pool, authPort, key, email, password, null);
  const { rows } = await pool.query<{
    id: string;
    cognito_refresh_token_encrypted: Buffer | null;
    cognito_cleanup_pending: boolean;
  }>(
    'SELECT id, cognito_refresh_token_encrypted, cognito_cleanup_pending FROM sessions WHERE id = $1',
    [result.sessionId],
  );
  return { sessionId: result.sessionId, row: rows[0]! };
}

describe('refresh token storage, decryption, and revocation (requirement 3)', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('login stores the refresh token encrypted (not plaintext), and cleanup decrypts + revokes the real token', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'tokenlifecycle1@example.com';
    const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
    const expectedRawToken = `stub-refresh-${sub}`;

    const { sessionId, row } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      TEST_TOKEN_ENCRYPTION_KEY,
    );
    expect(row.cognito_refresh_token_encrypted).not.toBeNull();
    // 저장된 바이트에 평문 토큰이 그대로 들어있지 않다(진짜로 암호화됐다는 것을 직접 확인).
    expect(row.cognito_refresh_token_encrypted!.toString('utf8')).not.toContain(expectedRawToken);
    expect(
      row.cognito_refresh_token_encrypted!.includes(Buffer.from(expectedRawToken, 'utf8')),
    ).toBe(false);

    await logoutAll(pool, (await findUserByEmail(pool, email))!.id);
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

    expect(authPort.wasTokenRevoked(expectedRawToken)).toBe(true);
    const { rows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]?.cognito_cleanup_pending).toBe(false);
  });

  it('retries a failed RevokeToken call and marks the session done only once it succeeds', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'tokenlifecycle2@example.com';
    const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
    const rawToken = `stub-refresh-${sub}`;

    const { sessionId } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      TEST_TOKEN_ENCRYPTION_KEY,
    );
    await logoutAll(pool, (await findUserByEmail(pool, email))!.id);

    authPort.simulateRevokeTokenFailureOnce(rawToken);

    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    let { rows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]?.cognito_cleanup_pending).toBe(true); // 첫 시도는 실패해 그대로 남아 있다
    expect(authPort.wasTokenRevoked(rawToken)).toBe(false);

    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    ({ rows } = await pool.query('SELECT cognito_cleanup_pending FROM sessions WHERE id = $1', [
      sessionId,
    ]));
    expect(rows[0]?.cognito_cleanup_pending).toBe(false); // 재시도에서 성공
    expect(authPort.wasTokenRevoked(rawToken)).toBe(true);
  });

  describe('key problems never get treated as "done", and nothing sensitive is logged', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    function assertNothingSensitiveLogged(secrets: string[]) {
      for (const spy of [warnSpy, errorSpy]) {
        for (const call of spy.mock.calls) {
          const text = call
            .map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ');
          for (const secret of secrets) expect(text).not.toContain(secret);
        }
      }
    }

    it('a missing encryption key at cleanup time does not mark the session done', async () => {
      const pool = await getTestPool();
      const authPort = createStubAuthPort();
      const email = 'tokenlifecycle3@example.com';
      const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
      const rawToken = `stub-refresh-${sub}`;
      const { sessionId } = await loginAndGetSessionRow(
        pool,
        authPort,
        email,
        'Passw0rd1!',
        TEST_TOKEN_ENCRYPTION_KEY,
      );
      await logoutAll(pool, (await findUserByEmail(pool, email))!.id);

      await runCleanupPendingAuthOnce(pool, authPort, undefined, 2 * 60 * 1000); // 키 없음

      const { rows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
        'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
        [sessionId],
      );
      expect(rows[0]?.cognito_cleanup_pending).toBe(true); // 완료로 처리되지 않았다
      expect(authPort.wasTokenRevoked(rawToken)).toBe(false);
      assertNothingSensitiveLogged([rawToken, TEST_TOKEN_ENCRYPTION_KEY.toString('base64')]);
    });

    it('the wrong encryption key at cleanup time does not mark the session done', async () => {
      const pool = await getTestPool();
      const authPort = createStubAuthPort();
      const email = 'tokenlifecycle4@example.com';
      const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
      const rawToken = `stub-refresh-${sub}`;
      const { sessionId } = await loginAndGetSessionRow(
        pool,
        authPort,
        email,
        'Passw0rd1!',
        TEST_TOKEN_ENCRYPTION_KEY,
      );
      await logoutAll(pool, (await findUserByEmail(pool, email))!.id);

      const wrongKey = randomBytes(32);
      await runCleanupPendingAuthOnce(pool, authPort, wrongKey, 2 * 60 * 1000);

      const { rows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
        'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
        [sessionId],
      );
      expect(rows[0]?.cognito_cleanup_pending).toBe(true);
      expect(authPort.wasTokenRevoked(rawToken)).toBe(false);
      assertNothingSensitiveLogged([
        rawToken,
        TEST_TOKEN_ENCRYPTION_KEY.toString('base64'),
        wrongKey.toString('base64'),
      ]);

      // 올바른 키로 다시 돌리면 정상 처리된다 — 영구히 막힌 게 아니라는 것도 함께 확인.
      await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
      const { rows: after } = await pool.query(
        'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
        [sessionId],
      );
      expect(after[0]?.cognito_cleanup_pending).toBe(false);
    });

    it('a corrupted stored ciphertext does not mark the session done', async () => {
      const pool = await getTestPool();
      const authPort = createStubAuthPort();
      const email = 'tokenlifecycle5@example.com';
      const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
      const rawToken = `stub-refresh-${sub}`;
      const { sessionId } = await loginAndGetSessionRow(
        pool,
        authPort,
        email,
        'Passw0rd1!',
        TEST_TOKEN_ENCRYPTION_KEY,
      );
      await logoutAll(pool, (await findUserByEmail(pool, email))!.id);

      // 저장된 암호문을 손상시킨다(디스크 오류·잘못된 마이그레이션 등을 흉내).
      await pool.query(`UPDATE sessions SET cognito_refresh_token_encrypted = $2 WHERE id = $1`, [
        sessionId,
        Buffer.from('not-a-real-ciphertext-value-at-all'),
      ]);

      await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

      const { rows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
        'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
        [sessionId],
      );
      expect(rows[0]?.cognito_cleanup_pending).toBe(true); // 완료로 처리되지 않았다
      expect(authPort.wasTokenRevoked(rawToken)).toBe(false);
      assertNothingSensitiveLogged([rawToken, TEST_TOKEN_ENCRYPTION_KEY.toString('base64')]);
    });
  });

  it('cleanup for one (old, revoked) session never invalidates a different, freshly created session for the same user', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'tokenlifecycle6@example.com';
    authPort.seedConfirmedUser(email, 'OldPassw0rd1!');

    const first = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'OldPassw0rd1!',
      null,
    );
    await logoutAll(pool, (await findUserByEmail(pool, email))!.id); // 첫 세션만 존재하는 상태에서 전체 로그아웃

    // 그 뒤 새로 로그인 — 새 세션·새 refresh token이 저장된다.
    const second = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'OldPassw0rd1!',
      null,
    );

    expect(await findValidSession(pool, first.sessionId)).toBeNull(); // 옛 세션은 무효
    expect(await findValidSession(pool, second.sessionId)).not.toBeNull(); // 새 세션은 유효

    // 정리 루틴이 옛 세션의 토큰을 폐기해도 새 세션은 전혀 영향받지 않는다.
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    expect(await findValidSession(pool, second.sessionId)).not.toBeNull();

    const { rows } = await pool.query<{ id: string; cognito_cleanup_pending: boolean }>(
      'SELECT id, cognito_cleanup_pending FROM sessions WHERE id = $1',
      [second.sessionId],
    );
    expect(rows[0]?.cognito_cleanup_pending).toBe(false); // 새 세션은 정리 대상이 된 적조차 없다
  });
});

describe('ordinary (single-session) logout also schedules Cognito token cleanup (requirement 2)', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('logout() atomically sets revoked_at and cognito_cleanup_pending in one statement', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'ordinary-logout-1@example.com';
    authPort.seedConfirmedUser(email, 'Passw0rd1!');
    const { sessionId } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      TEST_TOKEN_ENCRYPTION_KEY,
    );

    await logout(pool, sessionId);

    const { rows } = await pool.query<{
      revoked_at: Date | null;
      cognito_cleanup_pending: boolean;
    }>('SELECT revoked_at, cognito_cleanup_pending FROM sessions WHERE id = $1', [sessionId]);
    expect(rows[0]?.revoked_at).not.toBeNull();
    expect(rows[0]?.cognito_cleanup_pending).toBe(true); // 이전에는 여기가 false로 남아 누락됐었다
  });

  it('full path: ordinary logout → cleanup scheduled → RevokeToken fails once → retried to success', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'ordinary-logout-2@example.com';
    const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
    const rawToken = `stub-refresh-${sub}`;
    const { sessionId } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      TEST_TOKEN_ENCRYPTION_KEY,
    );

    await logout(pool, sessionId); // 일반 로그아웃(전체 로그아웃 아님)
    authPort.simulateRevokeTokenFailureOnce(rawToken);

    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    let { rows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(rows[0]?.cognito_cleanup_pending).toBe(true); // 첫 시도 실패, 그대로 남아 재시도 대상
    expect(authPort.wasTokenRevoked(rawToken)).toBe(false);

    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    ({ rows } = await pool.query('SELECT cognito_cleanup_pending FROM sessions WHERE id = $1', [
      sessionId,
    ]));
    expect(rows[0]?.cognito_cleanup_pending).toBe(false); // 재시도에서 성공
    expect(authPort.wasTokenRevoked(rawToken)).toBe(true);
  });

  it('calling logout() twice on the same session is a safe no-op the second time', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'ordinary-logout-3@example.com';
    authPort.seedConfirmedUser(email, 'Passw0rd1!');
    const { sessionId } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      TEST_TOKEN_ENCRYPTION_KEY,
    );

    await logout(pool, sessionId);
    const { rows: firstRows } = await pool.query<{ revoked_at: Date }>(
      'SELECT revoked_at FROM sessions WHERE id = $1',
      [sessionId],
    );
    const firstRevokedAt = firstRows[0]!.revoked_at;

    await logout(pool, sessionId); // 반복 호출 — revoked_at IS NULL 가드 때문에 아무 일도 안 함

    const { rows: secondRows } = await pool.query<{
      revoked_at: Date;
      cognito_cleanup_pending: boolean;
    }>('SELECT revoked_at, cognito_cleanup_pending FROM sessions WHERE id = $1', [sessionId]);
    expect(secondRows[0]?.revoked_at.getTime()).toBe(firstRevokedAt.getTime()); // 값이 다시 바뀌지 않았다
    expect(secondRows[0]?.cognito_cleanup_pending).toBe(true);
  });

  it('after cleanup completes, re-running the cleanup loop again is a no-op and does not call revokeToken again', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'ordinary-logout-4@example.com';
    const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
    const rawToken = `stub-refresh-${sub}`;
    const { sessionId } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      TEST_TOKEN_ENCRYPTION_KEY,
    );

    await logout(pool, sessionId);
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    expect(authPort.wasTokenRevoked(rawToken)).toBe(true);

    const { rows: afterFirst } = await pool.query<{
      cognito_cleanup_pending: boolean;
      cognito_refresh_token_encrypted: Buffer | null;
    }>(
      'SELECT cognito_cleanup_pending, cognito_refresh_token_encrypted FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(afterFirst[0]?.cognito_cleanup_pending).toBe(false);
    expect(afterFirst[0]?.cognito_refresh_token_encrypted).toBeNull(); // 암호문도 함께 지워졌다

    // 다시 정리 루틴을 돌려도 아무 일도 없어야 한다(이미 cleanup_pending=false라 대상에서 빠진다).
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    const { rows: afterSecond } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [sessionId],
    );
    expect(afterSecond[0]?.cognito_cleanup_pending).toBe(false);
  });

  it('recovers a session that was revoked by the old buggy path (revoked_at set, cognito_cleanup_pending never set) without touching a different, currently-valid session for the same user', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'ordinary-logout-5@example.com';
    const { sub } = authPort.seedConfirmedUser(email, 'Passw0rd1!');
    const staleRawToken = `stub-refresh-${sub}`;

    // 예전 버그가 있던 로그아웃 경로를 그대로 흉내 낸다 — cognito_cleanup_pending을 세우지
    // 않은 채 revoked_at만 기록된, 과거에 남겨진 데이터 상태를 재현한다.
    const { sessionId: staleSessionId, row: staleRow } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      TEST_TOKEN_ENCRYPTION_KEY,
    );
    expect(staleRow.cognito_refresh_token_encrypted).not.toBeNull();
    await pool.query(`UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1`, [
      staleSessionId,
    ]);
    const { rows: beforeRecovery } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [staleSessionId],
    );
    expect(beforeRecovery[0]?.cognito_cleanup_pending).toBe(false); // 버그가 있던 상태를 정확히 재현

    // 다른 기기의(또는 그 이후 새로) 로그인한, 여전히 유효한 세션도 하나 만들어 둔다 — 이 세션은
    // 절대 영향을 받으면 안 된다.
    const otherLogin = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'Passw0rd1!',
      null,
    );

    // 정리 루틴의 자가 치유 단계가 stale 세션을 정리 대상으로 되돌리고, 이어서 실제로 폐기한다.
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

    expect(authPort.wasTokenRevoked(staleRawToken)).toBe(true);
    const { rows: afterRecovery } = await pool.query<{
      cognito_cleanup_pending: boolean;
      cognito_refresh_token_encrypted: Buffer | null;
    }>(
      'SELECT cognito_cleanup_pending, cognito_refresh_token_encrypted FROM sessions WHERE id = $1',
      [staleSessionId],
    );
    expect(afterRecovery[0]?.cognito_cleanup_pending).toBe(false);
    expect(afterRecovery[0]?.cognito_refresh_token_encrypted).toBeNull();

    // 다른(현재 유효한) 세션은 전혀 손대지 않았다.
    expect(await findValidSession(pool, otherLogin.sessionId)).not.toBeNull();
    const { rows: otherRows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [otherLogin.sessionId],
    );
    expect(otherRows[0]?.cognito_cleanup_pending).toBe(false); // 정리 대상이 된 적조차 없다

    // 한 번 더 돌려도 안전하다(idempotent) — 이미 처리된 세션을 다시 건드리지 않는다.
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);
    const { rows: afterSecondRun } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [staleSessionId],
    );
    expect(afterSecondRun[0]?.cognito_cleanup_pending).toBe(false);
  });

  it('never recovers a revoked session that had no stored token in the first place', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'ordinary-logout-6@example.com';
    authPort.seedConfirmedUser(email, 'Passw0rd1!');

    // 암호화 키 없이 로그인해, 애초에 토큰을 저장하지 못한 세션을 만든다.
    const { sessionId } = await loginAndGetSessionRow(
      pool,
      authPort,
      email,
      'Passw0rd1!',
      undefined,
    );
    await pool.query(`UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1`, [
      sessionId,
    ]);

    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

    const { rows } = await pool.query<{ cognito_cleanup_pending: boolean }>(
      'SELECT cognito_cleanup_pending FROM sessions WHERE id = $1',
      [sessionId],
    );
    // 폐기할 토큰 자체가 없으므로 복구 대상이 되지 않는다 — 계속 false로 남아야 한다.
    expect(rows[0]?.cognito_cleanup_pending).toBe(false);
  });
});
