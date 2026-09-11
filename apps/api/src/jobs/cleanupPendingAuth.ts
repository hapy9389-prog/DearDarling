import type { Pool } from 'pg';
import {
  listRecoveriesNeedingVersionApplication,
  listRecoveriesNeedingSessionCleanup,
  listStaleUnresolvedRecoveries,
  applyRecoveryConfirmation,
  revokeSessionsForRecovery,
} from '../repositories/authRecoveryRepository';
import {
  listSessionsPendingCognitoCleanup,
  markSessionCognitoCleanupDone,
  recoverRevokedSessionsMissingCleanupFlag,
} from '../repositories/sessionsRepository';
import type { CognitoAuthPort } from '../cognito/authPort';
import { decryptToken } from '../cognito/tokenCipher';
import { logSafeError } from '../logging/safeError';

export const STALE_PENDING_MS_DEFAULT = 2 * 60 * 1000; // 2분(계획 §3-6)

/**
 * 정리 루틴 한 번의 실행(계획 §3-6). 각 단계는 독립된 트랜잭션이며(하위 함수들이 각자
 * BEGIN/COMMIT한다), 도중에 죽어도 다음 호출이 같은 대상을 다시 찾아 처리한다(전부 idempotent) —
 * 이 함수 자체도 진행 상태를 따로 저장하지 않는다.
 */
export async function runCleanupPendingAuthOnce(
  pool: Pool,
  authPort: CognitoAuthPort,
  tokenEncryptionKey: Buffer | undefined,
  staleAfterMs: number = STALE_PENDING_MS_DEFAULT,
): Promise<void> {
  // 1. outcome은 confirmed/assumed로 이미 결정됐지만(=user_id가 그때 없어서) 아직
  //    target_auth_version이 적용되지 못한 행 — 그사이 사용자가 생겼는지 다시 확인한다.
  const needingVersion = await listRecoveriesNeedingVersionApplication(pool);
  for (const row of needingVersion) {
    await applyRecoveryConfirmation(pool, row.id, row.outcome as 'confirmed' | 'assumed');
  }

  // 2. 버전은 이미 올랐지만(target_auth_version 확정) 세션 정리(T2)가 아직 안 끝난 행.
  const needingSessionCleanup = await listRecoveriesNeedingSessionCleanup(pool);
  for (const row of needingSessionCleanup) {
    if (!row.user_id || row.target_auth_version === null) continue; // 방어적 — 조건상 항상 채워져 있어야 함
    try {
      await revokeSessionsForRecovery(pool, row.user_id, row.target_auth_version, row.id);
    } catch {
      // 다음 주기에 재시도 — 접근 차단은 이미 auth_version 비교가 보장한다.
    }
  }

  // 3. 응답을 못 받았거나(unknown), 응답 직후 죽은 것으로 보이는(stale pending) 행 — 보수적으로
  //    "성공했을 수 있다"고 표시한다. assumed는 confirmed와 다른 값으로 남는다(계획 요구사항 6).
  const stale = await listStaleUnresolvedRecoveries(pool, staleAfterMs);
  for (const row of stale) {
    await applyRecoveryConfirmation(pool, row.id, 'assumed');
  }

  // 4a. 자가 치유 — 이미 로그아웃됐지만 cognito_cleanup_pending이 한 번도 켜지지 않은 채 남은
  //     세션(과거 로그아웃 경로의 잔여 데이터 등)을 정리 대상으로 되돌린다. 이미 폐기까지 끝난
  //     세션은 markSessionCognitoCleanupDone이 암호문을 지워 두므로 여기 다시 걸리지 않는다.
  await recoverRevokedSessionsMissingCleanupFlag(pool);

  // 4b. Cognito 쪽 위생 정리(RevokeToken) — 세션별로 저장해 둔 refresh token을 복호화해 폐기한다.
  //     접근 차단 자체는 auth_version 비교로 이미 보장되므로 이 단계는 순수 위생 관리일 뿐이다.
  const pendingCleanup = await listSessionsPendingCognitoCleanup(pool);
  for (const row of pendingCleanup) {
    if (!row.cognito_refresh_token_encrypted) {
      // 저장된 토큰 자체가 없다(암호화 키 없이 로그인했거나 애초에 토큰이 없던 세션) — 더 시도할
      // 게 없으므로 완료 처리한다.
      await markSessionCognitoCleanupDone(pool, row.id);
      continue;
    }
    if (!tokenEncryptionKey) {
      // 키가 없으면 복호화할 수 없다 — 완료로 처리하지 않고 다음 주기에 다시 시도한다(키가
      // 나중에 설정되면 그때 처리된다). 토큰 값은 로그에 남기지 않는다.
      console.warn('[cleanupPendingAuth] 세션 정리 보류: 토큰 암호화 키가 설정되지 않았습니다.');
      continue;
    }
    let plainToken: string;
    try {
      plainToken = decryptToken(row.cognito_refresh_token_encrypted, tokenEncryptionKey);
    } catch (err) {
      // 키가 틀렸거나 저장된 값이 손상됐다 — 완료로 처리하지 않는다. TokenDecryptionError가
      // 아닌 다른 예외가 여기서 나올 일은 없어야 하지만(decryptToken이 항상 이 타입으로만
      // 던진다), 그래도 classifyError를 거쳐 message·stack을 직접 로그로 내보내지 않는다.
      logSafeError('[cleanupPendingAuth] 세션 정리 보류: 토큰 복호화 실패', err);
      continue;
    }
    try {
      await authPort.revokeToken(plainToken);
      await markSessionCognitoCleanupDone(pool, row.id);
    } catch (err) {
      // 다음 주기에 재시도 — 오류 내용에 토큰이 포함될 수 있어 message·stack을 로그로 남기지 않는다.
      logSafeError('[cleanupPendingAuth] RevokeToken 실패, 다음 주기에 재시도', err);
    }
  }
}

export interface CleanupLoopHandle {
  stop: () => void;
}

/** 서버 내 타이머 — 새 프로세스를 만들지 않는다(계획 §3-6). */
export function startCleanupPendingAuthLoop(
  pool: Pool,
  authPort: CognitoAuthPort,
  tokenEncryptionKey: Buffer | undefined,
  intervalMs = 30 * 1000,
): CleanupLoopHandle {
  const timer = setInterval(() => {
    runCleanupPendingAuthOnce(pool, authPort, tokenEncryptionKey).catch((err) => {
      logSafeError('[cleanupPendingAuth] 정리 루틴 실행 실패', err);
    });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
