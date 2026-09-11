interface PgErrorLike {
  code?: string;
}

// serialization_failure, deadlock_detected — 둘 다 "다시 시도하면 되는" 예상된 동시성 상황이지,
// 애플리케이션 버그가 아니다.
const RETRYABLE_PG_ERROR_CODES = new Set(['40001', '40P01']);

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as PgErrorLike).code;
      attempt += 1;
      if (!code || !RETRYABLE_PG_ERROR_CODES.has(code) || attempt >= maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}
