import type { Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate';
import { createPool } from '../../src/db/pool';

let pool: Pool | undefined;

export async function getTestPool(): Promise<Pool> {
  if (!pool) {
    // test/setup.ts가 DATABASE_URL을 이미 TEST_DATABASE_URL로 맞춰 둔 상태.
    pool = createPool(process.env.DATABASE_URL!);
    await runMigrations(pool);
  }
  return pool;
}

/**
 * 테스트 간 격리를 위해 매 테스트 전에 호출한다 — 참여자의 실제 데이터가 아니라 이 테스트 DB만
 * 지운다. sessions·entry_links·password_reset_recoveries는 users를 참조하므로 CASCADE로 함께
 * 지워지지만, rate_limit_counters는 users와 무관해 명시적으로 포함해야 한다.
 */
export async function resetTables(): Promise<void> {
  const p = await getTestPool();
  await p.query(
    'TRUNCATE TABLE consent_events, invites, users, couples, rate_limit_counters RESTART IDENTITY CASCADE',
  );
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
