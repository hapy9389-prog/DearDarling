import type { NextFunction, Request, Response } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 상태를 바꾸는 요청(POST/PUT/PATCH/DELETE)에 `Origin` 헤더가 허용된 출처와 일치하는지 확인한다.
 * 세션이 아직 없는 입장 링크 확인·소비 요청에도 똑같이 적용한다 — "이미 로그인된 요청만"이
 * 아니라 상태를 바꾸는 요청 전체에 예외 없이 건다.
 */
export function createOriginCheckMiddleware(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.header('origin');
    if (origin !== allowedOrigin) {
      res.status(403).json({ error: 'origin-not-allowed' });
      return;
    }
    next();
  };
}
