import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Pool } from 'pg';
import { createTestAuthMiddleware, requireAuth } from './middleware/testAuth';
import { createSessionAuthMiddleware } from './middleware/sessionAuth';
import { createOriginCheckMiddleware } from './middleware/originCheck';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { createHealthRouter } from './routes/health';
import { createTestUsersRouter } from './routes/testUsers';
import { createProfileRouter } from './routes/profile';
import { createInvitesRouter } from './routes/invites';
import { createCoupleRouter } from './routes/couple';
import { createConsentRouter } from './routes/consent';
import { createAuthRouter } from './routes/auth';
import type { CognitoAuthPort } from './cognito/authPort';

export interface AppOptions {
  pool: Pool;
  /** 명시적 로컬 테스트 모드에서만 true — 배포 설정에서는 항상 false여야 한다(src/config/env.ts). */
  localTestAuth: boolean;
  /** 상태를 바꾸는 요청의 Origin 검사에 쓰는 허용 출처(src/middleware/originCheck.ts). 필수값이다
   * — 누락 시 Origin 검사를 건너뛰는 경로는 없다(모든 호출부가 명시적으로 값을 넘겨야 한다). */
  allowedOrigin: string;
  /** Cognito API 래퍼 — 테스트는 스텁(src/cognito/stubAuthPort.ts)을 넘긴다. */
  authPort: CognitoAuthPort;
  /** refresh token을 세션에 암호화 저장하는 키(32바이트). 없으면 저장을 건너뛴다(개발 전용 폴백). */
  tokenEncryptionKey?: Buffer;
}

export function createApp({
  pool,
  localTestAuth,
  allowedOrigin,
  authPort,
  tokenEncryptionKey,
}: AppOptions): Express {
  const app = express();
  // 다른 모든 미들웨어(특히 express.json())보다 먼저 — 잘못된 JSON 파싱 오류에도 requestId가
  // 있어야 errorHandler가 그 요청을 안전하게(본문 없이) 로그로 연결할 수 있다.
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(cookieParser());
  app.use(createTestAuthMiddleware(localTestAuth));
  // 테스트 헤더로 이미 req.userId가 채워졌으면 그대로 두고, 아니면 세션 쿠키를 확인한다.
  app.use(createSessionAuthMiddleware(pool));

  app.use('/health', createHealthRouter(pool));

  if (localTestAuth) {
    // 라우트 자체가 localTestAuth=false면 등록되지 않는다 — 미들웨어가 헤더를 무시하는 것과
    // 별개로 한 겹 더 막는 구조다.
    app.use('/api/test', createTestUsersRouter(pool));
  }

  // 상태를 바꾸는 요청(POST/PUT/PATCH/DELETE) 전체에 Origin 검사를 건다 — 인증 라우트뿐 아니라
  // 세션 쿠키로 인증되는 모든 데이터 변경 라우트에도 예외 없이 적용한다(계획 §4). allowedOrigin이
  // 필수값이라 이 검사를 건너뛰는 경로 자체가 없다.
  const originCheck = createOriginCheckMiddleware(allowedOrigin);

  app.use('/api/auth', originCheck, createAuthRouter(pool, authPort, tokenEncryptionKey));

  app.use('/api/profile', originCheck, requireAuth, createProfileRouter(pool));
  app.use('/api/invites', originCheck, requireAuth, createInvitesRouter(pool));
  app.use('/api/couple', originCheck, requireAuth, createCoupleRouter(pool));
  app.use('/api/consent', originCheck, requireAuth, createConsentRouter(pool));

  app.use(errorHandler);

  return app;
}
