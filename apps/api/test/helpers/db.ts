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

/** 테스트 간 격리를 위해 매 테스트 전에 호출한다 — 참여자의 실제 데이터가 아니라 이 테스트 DB만 지운다. */
export async function resetTables(): Promise<void> {
  const p = await getTestPool();
  await p.query('TRUNCATE TABLE consent_events, invites, users, couples RESTART IDENTITY CASCADE');
}

export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
