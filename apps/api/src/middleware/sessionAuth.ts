import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { findValidSession } from '../repositories/sessionsRepository';
import { readSessionCookie } from '../http/sessionCookie';

declare module 'express-serve-static-core' {
  interface Request {
    sessionId?: string;
  }
}

/**
 * 실제 세션 쿠키 인증. `testAuthMiddleware` 다음 순서로 붙는다 — `req.userId`가 이미
 * 채워져 있으면(로컬 테스트 모드) 그대로 두고 손대지 않는다. 그 외에는 쿠키의 세션 id로
 * `sessions`를 조회해 유효할 때만 `req.userId`/`req.sessionId`를 채운다. 차단의 기준은
 * 항상 이 조회(= `sessions` 테이블)다.
 */
export function createSessionAuthMiddleware(pool: Pool) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (req.userId) {
      next();
      return;
    }
    const sessionId = readSessionCookie(req);
    if (!sessionId) {
      next();
      return;
    }
    try {
      const session = await findValidSession(pool, sessionId);
      if (session) {
        req.userId = session.user_id;
        req.sessionId = session.id;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
