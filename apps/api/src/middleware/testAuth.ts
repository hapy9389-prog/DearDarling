import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

const TEST_USER_HEADER = 'x-test-user-id';

/**
 * 로컬 테스트 모드 전용 인증 대체. `enabled`가 false면 헤더를 완전히 무시한다 —
 * 배포 설정에서는 이 값이 항상 false이고(src/config/env.ts가 기동 시점에 강제), 이 미들웨어
 * 자체는 존재해도 아무 효과가 없다. 실제 Cognito 세션 검증은 이후 연결 단계에서 이 자리를 대체한다.
 */
export function createTestAuthMiddleware(enabled: boolean) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (enabled) {
      const headerValue = req.header(TEST_USER_HEADER);
      if (headerValue) req.userId = headerValue;
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}
