import { randomBytes } from 'node:crypto';
import type { Response } from 'supertest';
import { createApp } from '../../src/app';
import { getTestPool } from './db';
import { createStubAuthPort, type StubAuthPort } from '../../src/cognito/stubAuthPort';

/** supertest 응답 타입은 set-cookie를 string으로 좁혀 두지만 실제로는 배열이다 — 테스트 전용 헬퍼. */
export function extractCookie(res: Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}

export const TEST_ALLOWED_ORIGIN = 'http://127.0.0.1:4000';

/** 테스트 전용 고정 키 — 세션 실행마다 새로 생성해도 되지만, 프로세스 안에서는 일관돼야
 * 서로 다른 테스트가 만든 암호문을 같은 키로 복호화할 수 있다(정리 루틴 테스트 등). */
export const TEST_TOKEN_ENCRYPTION_KEY = randomBytes(32);

/** profile/invites/couple/consent 등 Cognito와 무관한 테스트용 — 내부 스텁은 노출하지 않는다. */
export async function buildTestApp() {
  const pool = await getTestPool();
  return createApp({
    pool,
    localTestAuth: true,
    allowedOrigin: TEST_ALLOWED_ORIGIN,
    authPort: createStubAuthPort(),
    tokenEncryptionKey: TEST_TOKEN_ENCRYPTION_KEY,
  });
}

/** auth 관련 테스트용 — 호출부가 같은 authPort 인스턴스를 이용해 Cognito 쪽 상태를 준비·조작할 수 있다. */
export async function buildTestAppWithAuth(authPort: StubAuthPort = createStubAuthPort()) {
  const pool = await getTestPool();
  const app = createApp({
    pool,
    localTestAuth: true,
    allowedOrigin: TEST_ALLOWED_ORIGIN,
    authPort,
    tokenEncryptionKey: TEST_TOKEN_ENCRYPTION_KEY,
  });
  return { app, authPort };
}
