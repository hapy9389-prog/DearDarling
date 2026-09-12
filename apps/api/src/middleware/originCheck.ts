import type { NextFunction, Request, Response } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// 이 미들웨어는 라우터에 진입하기 전(각 라우터를 mount하는 지점)에 물려 있어 req.route가 아직
// 없다 — safeRouteLabel(safeError.ts)이 쓰는 방식을 그대로는 못 쓴다. 대신 `/api/auth` 아래
// 실제로 존재하는 고정 하위 경로만 허용목록으로 직접 들고 있다가, req.path가 그 중 하나와
// 정확히 같을 때만 그대로 남긴다 — 그 외(목록에 없거나 조작된 경로)는 req.baseUrl(app.ts에
// 고정으로 적어 둔 마운트 경로)까지만 남긴다. 둘 다 서버 코드에 있는 고정값이지 사용자가 보낸
// 실제 URL 전체가 아니다.
const KNOWN_AUTH_SUBPATHS = new Set([
  '/signup',
  '/confirm-signup',
  '/resend-confirmation',
  '/login',
  '/forgot-password',
  '/confirm-forgot-password',
  '/logout',
  '/logout-all',
]);

function safeOriginRejectionRoute(req: Request): string {
  const base = req.baseUrl || 'unmatched';
  if (base === '/api/auth' && KNOWN_AUTH_SUBPATHS.has(req.path)) {
    return `${base}${req.path}`;
  }
  return base;
}

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
      // 진단용 로그 — requestId·고정 라우트명·상태만 남긴다. 실제로 보낸 Origin 헤더 값이나
      // 그 밖의 요청 헤더는 남기지 않는다(허용된 값과 다르다는 사실만으로 충분하다).
      console.error('[originCheck]', {
        requestId: req.requestId,
        route: safeOriginRejectionRoute(req),
        status: 403,
        category: 'origin-not-allowed',
      });
      res.status(403).json({ error: 'origin-not-allowed' });
      return;
    }
    next();
  };
}
