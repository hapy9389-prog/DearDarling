import { createApp } from './app';
import { loadDotEnv } from './config/loadDotEnv';
import { loadEnv } from './config/env';
import { runMigrations } from './db/migrate';
import { createPool } from './db/pool';
import { createCognitoClient } from './cognito/client';
import { createCognitoAuthPort } from './cognito/cognitoAuthPort';
import { createStubAuthPort } from './cognito/stubAuthPort';
import { startCleanupPendingAuthLoop } from './jobs/cleanupPendingAuth';
import type { CognitoAuthPort } from './cognito/authPort';
import { logSafeError } from './logging/safeError';

async function main() {
  loadDotEnv(); // apps/api/.env — 이미 셸에 설정된 값은 덮어쓰지 않는다.
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);
  await runMigrations(pool);

  let authPort: CognitoAuthPort;
  if (env.cognito) {
    const client = createCognitoClient(env.cognito.region);
    authPort = createCognitoAuthPort(client, env.cognito);
  } else {
    // Cognito 설정이 없는 로컬 개발용 폴백 — production에서는 loadEnv()가 이미 기동을 거부한다.
    console.warn(
      '[auth] COGNITO_* 환경변수가 설정되지 않아 개발용 스텁 인증 포트로 기동합니다. ' +
        '실제 가입·로그인은 동작하지 않습니다(.env.example 참고).',
    );
    authPort = createStubAuthPort();
  }

  if (!env.tokenEncryptionKey) {
    console.warn(
      '[auth] SESSION_TOKEN_ENCRYPTION_KEY가 설정되지 않아 refresh token을 저장하지 않습니다. ' +
        'Cognito 쪽 토큰 폐기(RevokeToken) 위생 관리가 동작하지 않습니다(.env.example 참고).',
    );
  }

  const app = createApp({
    pool,
    localTestAuth: env.localTestAuth,
    allowedOrigin: env.allowedOrigin,
    authPort,
    tokenEncryptionKey: env.tokenEncryptionKey,
  });

  startCleanupPendingAuthLoop(pool, authPort, env.tokenEncryptionKey);

  // 127.0.0.1에만 바인딩 — 이 서버는 외부에 직접 노출하지 않는다(0.0.0.0로 바꾸지 말 것).
  app.listen(env.port, '127.0.0.1', () => {
    console.log(
      `apps/api listening on http://127.0.0.1:${env.port} (nodeEnv=${env.nodeEnv}, localTestAuth=${env.localTestAuth})`,
    );
  });
}

main().catch((err) => {
  // err를 그대로 찍지 않는다 — DB 연결 실패 등에서 err.message가 DATABASE_URL(비밀번호 포함)
  // 조각을 담고 있을 수 있다.
  logSafeError('서버 기동 실패', err);
  process.exitCode = 1;
});
