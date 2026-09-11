import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';

export interface RateLimitOptions {
  /** rate_limit_counters.scope — 엔드포인트별로 구분한다. */
  scope: string;
  limit: number;
  windowMs: number;
  /** 기본값은 요청 출처(IP) — 계정이 아니라 출처를 잠근다(남의 계정을 반복 실패시켜 잠그지 못하게). */
  keyFn?: (req: Request) => string;
}

/** `rate_limit_counters`에 원자적 UPSERT로 카운트를 쌓는다 — 동시 요청에도 유실이 없다. */
export function createRateLimiter(pool: Pool, options: RateLimitOptions) {
  const keyFn = options.keyFn ?? ((req: Request) => req.ip ?? 'unknown');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sourceKey = keyFn(req);
      const windowStart = new Date(Math.floor(Date.now() / options.windowMs) * options.windowMs);
      const { rows } = await pool.query<{ count: number }>(
        `INSERT INTO rate_limit_counters (scope, source_key, window_start, count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (scope, source_key, window_start)
         DO UPDATE SET count = rate_limit_counters.count + 1
         RETURNING count`,
        [options.scope, sourceKey, windowStart],
      );
      if ((rows[0]?.count ?? 0) > options.limit) {
        res.status(429).json({ error: 'rate-limited' });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
