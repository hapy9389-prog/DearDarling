import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { getTestPool, resetTables } from '../helpers/db';
import { createCognitoAuthPort } from '../../src/cognito/cognitoAuthPort';
import { createStubAuthPort } from '../../src/cognito/stubAuthPort';
import type { CognitoConfig } from '../../src/cognito/client';
import { confirmForgotPassword, login } from '../../src/services/authService';
import {
  markRecoveryFailed,
  markRecoveryUnknown,
} from '../../src/repositories/authRecoveryRepository';
import { findValidSession } from '../../src/repositories/sessionsRepository';
import { TEST_TOKEN_ENCRYPTION_KEY } from '../helpers/app';

const CONFIG: CognitoConfig = {
  region: 'ap-northeast-2',
  userPoolId: 'ap-northeast-2_ABC123DEF',
  clientId: 'client',
  clientSecret: 'secret',
};

function fakeClientThrowing(err: unknown): CognitoIdentityProviderClient {
  return { send: async () => Promise.reject(err) } as unknown as CognitoIdentityProviderClient;
}

describe('requirement 1 — ambiguous Cognito errors never close a recovery as failed (real adapter, no AWS calls)', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('ECONNRESET-style network errors leave outcome=unknown, not failed', async () => {
    const pool = await getTestPool();
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const authPort = createCognitoAuthPort(fakeClientThrowing(err), CONFIG);

    const outcome = await confirmForgotPassword(
      pool,
      authPort,
      'econnreset@example.com',
      '000000',
      'NewPassw0rd1!',
    );
    expect(outcome).toBe('unknown');

    const { rows } = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM password_reset_recoveries WHERE email = $1',
      ['econnreset@example.com'],
    );
    expect(rows[0]?.outcome).toBe('unknown');
  });

  it('InternalErrorException leaves outcome=unknown, not failed', async () => {
    const pool = await getTestPool();
    const err = Object.assign(new Error('cognito internal error'), {
      name: 'InternalErrorException',
    });
    const authPort = createCognitoAuthPort(fakeClientThrowing(err), CONFIG);

    const outcome = await confirmForgotPassword(
      pool,
      authPort,
      'internal-error@example.com',
      '000000',
      'NewPassw0rd1!',
    );
    expect(outcome).toBe('unknown');

    const { rows } = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM password_reset_recoveries WHERE email = $1',
      ['internal-error@example.com'],
    );
    expect(rows[0]?.outcome).toBe('unknown');
  });

  it('a genuine CodeMismatchException (contrast case) still closes as failed', async () => {
    const pool = await getTestPool();
    const err = Object.assign(new Error('mismatch'), { name: 'CodeMismatchException' });
    const authPort = createCognitoAuthPort(fakeClientThrowing(err), CONFIG);

    const outcome = await confirmForgotPassword(
      pool,
      authPort,
      'mismatch@example.com',
      '000000',
      'NewPassw0rd1!',
    );
    expect(outcome).toBe('rejected');

    const { rows } = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM password_reset_recoveries WHERE email = $1',
      ['mismatch@example.com'],
    );
    expect(rows[0]?.outcome).toBe('failed');
  });
});

describe('requirement 2 — T1 failure after Cognito confirms is distinguished, not a generic 500', () => {
  const CONSTRAINT_NAME = 'test_block_auth_version_bump_to_one';

  beforeEach(async () => {
    await resetTables();
  });

  afterEach(async () => {
    const pool = await getTestPool();
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
  });

  it('returns confirmed-local-pending when T1 fails even after retries, and cleanup finishes the job later', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'localpending@example.com';
    authPort.seedConfirmedUser(email, 'OldPassw0rd1!');

    const loginResult = await login(
      pool,
      authPort,
      TEST_TOKEN_ENCRYPTION_KEY,
      email,
      'OldPassw0rd1!',
      null,
    );
    await authPort.forgotPassword(email);

    // T1(applyRecoveryConfirmation)의 `UPDATE users SET auth_version = 1`만 실제로, 결정적으로
    // 실패하게 만든다 — pg 클라이언트를 Proxy로 감싸는 대신(내부 private 필드와 충돌해
    // 불안정해진다) DB 제약 위반이라는 진짜 오류를 일으켜 "실제 서비스 경로"를 그대로 태운다.
    // check_violation(23514)은 withRetry의 재시도 대상(40001/40P01)이 아니라 즉시 실패하지만,
    // "T1이 실패했을 때" 처리(요구사항 2)를 검증하는 데는 재시도 소진 여부가 본질이 아니다 —
    // withRetry 자체의 재시도 동작은 test/db/retry.test.ts가 별도로 검증한다.
    await pool.query(
      `ALTER TABLE users ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (auth_version <> 1)`,
    );

    const outcome = await confirmForgotPassword(pool, authPort, email, '222222', 'NewPassw0rd2!');
    expect(outcome).toBe('confirmed-local-pending');

    // 제약을 없애야 이후(정리 루틴 등)가 정상적으로 성공할 수 있다.
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);

    // 이 요청 안에서는 차단이 아직 안 끝났다 — 기존 세션이 여전히 유효하다.
    expect(await findValidSession(pool, loginResult.sessionId)).not.toBeNull();

    // 그래도 Cognito가 확인했다는 사실 자체는 durable하게 남아 있다(outcome='pending', T0만 성공).
    const { rows } = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM password_reset_recoveries WHERE email = $1',
      [email],
    );
    expect(rows[0]?.outcome).toBe('pending');

    // 실제 비밀번호는 이미 Cognito에서 바뀌었다 — 새 비밀번호로 로그인이 된다.
    await expect(
      login(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, email, 'NewPassw0rd2!', null),
    ).resolves.toBeDefined();

    // 정리 루틴(장애가 없는 정상 pool로)이 나중에 이어받아 차단을 완료한다.
    const { runCleanupPendingAuthOnce } = await import('../../src/jobs/cleanupPendingAuth');
    await pool.query(
      `UPDATE password_reset_recoveries SET requested_at = clock_timestamp() - interval '10 minutes' WHERE email = $1`,
      [email],
    );
    await runCleanupPendingAuthOnce(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, 2 * 60 * 1000);

    expect(await findValidSession(pool, loginResult.sessionId)).toBeNull(); // 이제야 무효화됨
  });
});

describe('requirement 5 — a late unknown/failed write never reopens an already-resolved recovery', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('markRecoveryFailed does not downgrade an already-confirmed(and applied) recovery', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'already-resolved-1@example.com';
    authPort.seedConfirmedUser(email, 'OldPassw0rd1!');
    await login(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, email, 'OldPassw0rd1!', null);
    await authPort.forgotPassword(email);
    const outcome = await confirmForgotPassword(pool, authPort, email, '222222', 'NewPassw0rd2!');
    expect(outcome).toBe('confirmed-sessions-revoked');

    const { rows: before } = await pool.query<{
      id: string;
      outcome: string;
      target_auth_version: number;
    }>('SELECT id, outcome, target_auth_version FROM password_reset_recoveries WHERE email = $1', [
      email,
    ]);
    expect(before[0]?.outcome).toBe('confirmed');

    // 이미 처리가 끝난 뒤 도착한 "거절" 판정 — 되돌려서는 안 된다.
    await markRecoveryFailed(pool, before[0]!.id);

    const { rows: after } = await pool.query<{ outcome: string; target_auth_version: number }>(
      'SELECT outcome, target_auth_version FROM password_reset_recoveries WHERE id = $1',
      [before[0]!.id],
    );
    expect(after[0]?.outcome).toBe('confirmed'); // 그대로
    expect(after[0]?.target_auth_version).toBe(before[0]!.target_auth_version);
  });

  it('markRecoveryUnknown does not downgrade an already-confirmed(and applied) recovery', async () => {
    const pool = await getTestPool();
    const authPort = createStubAuthPort();
    const email = 'already-resolved-2@example.com';
    authPort.seedConfirmedUser(email, 'OldPassw0rd1!');
    await login(pool, authPort, TEST_TOKEN_ENCRYPTION_KEY, email, 'OldPassw0rd1!', null);
    await authPort.forgotPassword(email);
    await confirmForgotPassword(pool, authPort, email, '222222', 'NewPassw0rd2!');

    const { rows: before } = await pool.query<{ id: string }>(
      'SELECT id FROM password_reset_recoveries WHERE email = $1',
      [email],
    );

    await markRecoveryUnknown(pool, before[0]!.id);

    const { rows: after } = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM password_reset_recoveries WHERE id = $1',
      [before[0]!.id],
    );
    expect(after[0]?.outcome).toBe('confirmed'); // 'unknown'으로 되돌아가지 않는다
  });

  it('markRecoveryFailed does not downgrade an already-assumed recovery', async () => {
    const pool = await getTestPool();
    const { applyRecoveryConfirmation, createPasswordResetRecovery } =
      await import('../../src/repositories/authRecoveryRepository');
    const email = 'already-assumed@example.com';
    const recovery = await createPasswordResetRecovery(pool, email);
    await applyRecoveryConfirmation(pool, recovery.id, 'assumed');

    await markRecoveryFailed(pool, recovery.id);

    const { rows } = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM password_reset_recoveries WHERE id = $1',
      [recovery.id],
    );
    expect(rows[0]?.outcome).toBe('assumed');
  });
});
