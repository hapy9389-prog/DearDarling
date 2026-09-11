import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { runMigrations } from '../../src/db/migrate';

/**
 * 마이그레이션 0004가 "0003까지 적용되고 실제 데이터가 있는 DB"에서도 기존 데이터를 지우지
 * 않는지(계획 §1의 시나리오 b) — 0001+0002만 있는 DB에 대한 시나리오 a는 test/setup.ts가
 * 강제하는 TEST_DATABASE_URL(pretest에서 이미 0001→0004까지 순서대로 적용됨)로 이미 매 테스트
 * 실행마다 검증된다. 이 파일은 그와 별개로, 격리된 전용 임시 DB를 직접 만들어 시나리오 b만
 * 재현한다 — 이름은 "_test"로 끝나게 해 실수로 실 데이터베이스를 겨냥하지 않게 한다.
 */
const DB_NAME = 'deardarling_migration_scenario_b_test';

function adminConnectionString(): string {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  base.pathname = '/postgres';
  return base.toString();
}

function scenarioConnectionString(): string {
  const base = new URL(process.env.TEST_DATABASE_URL!);
  base.pathname = `/${DB_NAME}`;
  return base.toString();
}

describe('migration 0004 on a DB that already has 0003 applied with real data', () => {
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminConnectionString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();

    pool = new Pool({ connectionString: scenarioConnectionString() });
    // 0001~0003까지 먼저 적용한다(0004가 아직 없던 시절의 상태를 재현).
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    const admin = new Client({ connectionString: adminConnectionString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.end();
  });

  it('preserves existing users/couples/invites/consent data and only revokes (not deletes) old entry_links/sessions', async () => {
    // 0004까지 전부 이미 적용된 상태에서 시작하므로(위 beforeAll), 실제 "적용 전" 상태를 만들려면
    // schema_migrations에서 0004 기록만 지우고 0004가 추가한 컬럼/테이블도 되돌린 뒤 다시
    // runMigrations를 호출해 0004 적용 자체를 재현한다.
    await pool.query('DELETE FROM schema_migrations WHERE version = $1', ['0004_cognito_auth.sql']);
    await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS cognito_sub');
    await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS auth_version');
    await pool.query('ALTER TABLE sessions DROP COLUMN IF EXISTS created_with_auth_version');
    await pool.query('ALTER TABLE sessions DROP COLUMN IF EXISTS cognito_refresh_token_encrypted');
    await pool.query('ALTER TABLE sessions DROP COLUMN IF EXISTS cognito_cleanup_pending');
    await pool.query('DROP TABLE IF EXISTS password_reset_recoveries');

    // 실제 데이터를 심는다: 기존 사용자·커플·초대·동의 이력 + 아직 안 쓴 entry_link·안 폐기된 session.
    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, nickname) VALUES ('existing@example.com', '기존사용자') RETURNING id`,
    );
    const userId = userRows[0]!.id;
    const { rows: coupleRows } = await pool.query<{ id: string }>(
      `INSERT INTO couples (relationship_start_date) VALUES ('2024-01-01') RETURNING id`,
    );
    await pool.query(`UPDATE users SET couple_id = $1 WHERE id = $2`, [coupleRows[0]!.id, userId]);
    await pool.query(
      `INSERT INTO invites (code, inviter_user_id, expires_at) VALUES ('DD-999999', $1, now() + interval '7 days')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO consent_events (user_id, granted, version) VALUES ($1, true, 1)`,
      [userId],
    );
    const { rows: entryLinkRows } = await pool.query<{ id: string }>(
      `INSERT INTO entry_links (token_hash, user_id, expires_at)
       VALUES ('deadbeef', $1, now() + interval '7 days') RETURNING id`,
      [userId],
    );
    const { rows: sessionRows } = await pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, expires_at) VALUES ($1, now() + interval '30 days') RETURNING id`,
      [userId],
    );

    // 0004를 적용한다.
    const applied = await runMigrations(pool);
    expect(applied).toEqual(['0004_cognito_auth.sql']);

    // 기존 데이터는 행 수·내용 그대로.
    const { rows: usersAfter } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    expect(usersAfter).toHaveLength(1);
    expect(usersAfter[0].email).toBe('existing@example.com');
    expect(usersAfter[0].couple_id).toBe(coupleRows[0]!.id);
    const { rows: invitesAfter } = await pool.query(
      'SELECT * FROM invites WHERE inviter_user_id = $1',
      [userId],
    );
    expect(invitesAfter).toHaveLength(1);
    const { rows: consentAfter } = await pool.query(
      'SELECT * FROM consent_events WHERE user_id = $1',
      [userId],
    );
    expect(consentAfter).toHaveLength(1);

    // 기존 entry_link·session은 삭제되지 않고 무효화만 됐다.
    const { rows: linkAfter } = await pool.query('SELECT * FROM entry_links WHERE id = $1', [
      entryLinkRows[0]!.id,
    ]);
    expect(linkAfter).toHaveLength(1);
    expect(linkAfter[0].status).toBe('revoked');

    const { rows: sessionAfter } = await pool.query('SELECT * FROM sessions WHERE id = $1', [
      sessionRows[0]!.id,
    ]);
    expect(sessionAfter).toHaveLength(1);
    expect(sessionAfter[0].revoked_at).not.toBeNull();

    // 새 컬럼·테이블이 기본값으로 잘 붙었는지.
    expect(usersAfter[0].auth_version).toBe(0);
    expect(usersAfter[0].cognito_sub).toBeNull();
    const { rows: recoveriesTable } = await pool.query(
      `SELECT to_regclass('password_reset_recoveries') AS reg`,
    );
    expect(recoveriesTable[0]?.reg).toBe('password_reset_recoveries');
  });
});
