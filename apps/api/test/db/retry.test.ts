import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/db/retry';

function pgError(code: string): Error & { code: string } {
  const err = new Error(`pg error ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

describe('withRetry', () => {
  it('retries on serialization_failure and eventually succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw pgError('40001');
      return 'ok';
    });
    await expect(withRetry(fn, 5)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on deadlock_detected', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw pgError('40P01');
      return 'ok';
    });
    await expect(withRetry(fn, 5)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const err = pgError('23505');
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, 5)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts', async () => {
    const err = pgError('40P01');
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, 2)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
