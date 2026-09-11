import type { NextFunction, Request, Response } from 'express';
import { newRequestId } from '../logging/safeError';

declare module 'express-serve-static-core' {
  interface Request {
    /** 비밀정보를 담지 않는 무작위 값 — 로그 줄을 같은 요청끼리 연결하기 위한 용도로만 쓴다. */
    requestId: string;
  }
}

/** 다른 모든 미들웨어(특히 express.json()) 앞에 마운트한다 — 본문 파싱 오류에도 값이 있어야 한다. */
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = newRequestId();
  next();
}
