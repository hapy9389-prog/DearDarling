import express, { type Express } from 'express';
import type { Pool } from 'pg';
import { createTestAuthMiddleware, requireAuth } from './middleware/testAuth';
import { errorHandler } from './middleware/errorHandler';
import { createHealthRouter } from './routes/health';
import { createTestUsersRouter } from './routes/testUsers';
import { createProfileRouter } from './routes/profile';
import { createInvitesRouter } from './routes/invites';
import { createCoupleRouter } from './routes/couple';
import { createConsentRouter } from './routes/consent';

export interface AppOptions {
  pool: Pool;
  /** 명시적 로컬 테스트 모드에서만 true — 배포 설정에서는 항상 false여야 한다(src/config/env.ts). */
  localTestAuth: boolean;
}

export function createApp({ pool, localTestAuth }: AppOptions): Express {
  const app = express();
  app.use(express.json());
  app.use(createTestAuthMiddleware(localTestAuth));

  app.use('/health', createHealthRouter(pool));

  if (localTestAuth) {
    // 라우트 자체가 localTestAuth=false면 등록되지 않는다 — 미들웨어가 헤더를 무시하는 것과
    // 별개로 한 겹 더 막는 구조다.
    app.use('/api/test', createTestUsersRouter(pool));
  }

  app.use('/api/profile', requireAuth, createProfileRouter(pool));
  app.use('/api/invites', requireAuth, createInvitesRouter(pool));
  app.use('/api/couple', requireAuth, createCoupleRouter(pool));
  app.use('/api/consent', requireAuth, createConsentRouter(pool));

  app.use(errorHandler);

  return app;
}
