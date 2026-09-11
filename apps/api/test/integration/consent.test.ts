import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app';
import { resetTables, getTestPool } from '../helpers/db';
import { createUser } from '../../src/repositories/usersRepository';
import {
  applyConsentChangeInTransaction,
  listConsentHistory,
  recordConsentChange,
} from '../../src/repositories/consentRepository';

describe('consent API', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('defaults to consent off and records history on every change', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    const initial = await request(app)
      .get('/api/profile')
      .set('X-Test-User-Id', user.id)
      .expect(200);
    expect(initial.body.analysis_consent).toBe(false);

    await request(app)
      .put('/api/consent')
      .set('X-Test-User-Id', user.id)
      .send({ granted: true })
      .expect(200);
    await request(app)
      .put('/api/consent')
      .set('X-Test-User-Id', user.id)
      .send({ granted: false })
      .expect(200);

    const history = await request(app)
      .get('/api/consent/history')
      .set('X-Test-User-Id', user.id)
      .expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[0].granted).toBe(true);
    expect(history.body[1].granted).toBe(false);

    const current = await request(app)
      .get('/api/profile')
      .set('X-Test-User-Id', user.id)
      .expect(200);
    expect(current.body.analysis_consent).toBe(false);
  });

  it('rejects non-boolean granted values and leaves state unchanged', async () => {
    const app = await buildTestApp();
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    for (const invalid of ['false', 'true', 0, 1, null, undefined, {}, []]) {
      await request(app)
        .put('/api/consent')
        .set('X-Test-User-Id', user.id)
        .send({ granted: invalid })
        .expect(400);
    }
    // granted 필드 자체가 없는 경우도 거부한다.
    await request(app).put('/api/consent').set('X-Test-User-Id', user.id).send({}).expect(400);

    const profile = await request(app)
      .get('/api/profile')
      .set('X-Test-User-Id', user.id)
      .expect(200);
    expect(profile.body.analysis_consent).toBe(false);
    const history = await listConsentHistory(pool, user.id);
    expect(history).toHaveLength(0);
  });

  it('rolls back via recordConsentChange itself when its own history INSERT fails (not a test-driven ROLLBACK)', async () => {
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    // 사용자의 consent_version은 아직 0이므로 recordConsentChange는 다음 버전으로 1을 계산해
    // consent_events(user_id, version=1)에 넣으려 한다. 같은 (user_id, version=1) 행을 미리
    // 심어 두면 서비스 자신의 INSERT가 실제 유니크 제약 위반으로 실패한다 — 트랜잭션을
    // 테스트가 대신 끊는 게 아니라 recordConsentChange 내부의 오류 처리가 시험대에 오른다.
    await pool.query('INSERT INTO consent_events (user_id, granted, version) VALUES ($1, $2, $3)', [
      user.id,
      true,
      1,
    ]);

    await expect(recordConsentChange(pool, user.id, true)).rejects.toThrow();

    const { rows } = await pool.query<{ analysis_consent: boolean; consent_version: number }>(
      'SELECT analysis_consent, consent_version FROM users WHERE id = $1',
      [user.id],
    );
    // UPDATE는 실제로 실행된 뒤(analysis_consent=true, consent_version=1로 바뀐 순간이 있었다)
    // INSERT 실패로 같은 트랜잭션이 롤백돼 가입 시 기본값 그대로여야 한다.
    expect(rows[0]?.analysis_consent).toBe(false);
    expect(rows[0]?.consent_version).toBe(0);

    const history = await listConsentHistory(pool, user.id);
    expect(history).toHaveLength(1); // 미리 심어 둔 행 하나만 — 서비스가 새로 남긴 이력은 없다
    expect(history[0]?.version).toBe(1);
  });

  it('orders history by version (not transaction-start time) when an earlier-started request commits last', async () => {
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    const clientA = await pool.connect();
    try {
      // A가 먼저 트랜잭션을 시작한다 — now()를 썼다면 A의 changed_at이 더 이를 시점이다.
      await clientA.query('BEGIN');

      // B는 나중에 시작하지만 A가 사용자 행을 잠그기 전에 끝까지 처리·커밋된다 —
      // "먼저 시작했지만 나중에 처리됨"을 재현한다.
      await recordConsentChange(pool, user.id, false);

      // A가 이제서야 잠그고 처리한다(B가 이미 커밋했으니 잠금 대기 없이 바로 획득한다).
      const { rows: lockedRows } = await clientA.query<{ consent_version: number }>(
        'SELECT consent_version FROM users WHERE id = $1 FOR UPDATE',
        [user.id],
      );
      const nextVersion = (lockedRows[0]?.consent_version ?? 0) + 1;
      await applyConsentChangeInTransaction(clientA, user.id, true, nextVersion);
      await clientA.query('COMMIT');
    } finally {
      clientA.release();
    }

    const history = await listConsentHistory(pool, user.id);
    expect(history).toHaveLength(2);
    expect(history[0]?.granted).toBe(false); // B — 실제로 먼저 처리됨
    expect(history[0]?.version).toBe(1);
    expect(history[1]?.granted).toBe(true); // A — 나중에 처리됨, 버전이 더 크다
    expect(history[1]?.version).toBe(2);
    // clock_timestamp()를 쓰므로 실제 실행 순서대로 changed_at도 앞선다(이전에 now()를 쓸 때는
    // A가 트랜잭션을 먼저 시작했다는 이유만으로 changed_at이 더 이르게 찍혀 순서가 뒤집혔었다).
    expect(history[0]!.changed_at.getTime()).toBeLessThanOrEqual(history[1]!.changed_at.getTime());

    const { rows } = await pool.query<{ analysis_consent: boolean; consent_version: number }>(
      'SELECT analysis_consent, consent_version FROM users WHERE id = $1',
      [user.id],
    );
    // 현재값은 실제로 마지막에 처리된 A(true)와 일치해야 한다.
    expect(rows[0]?.analysis_consent).toBe(true);
    expect(rows[0]?.consent_version).toBe(2);
    expect(rows[0]?.consent_version).toBe(history[history.length - 1]?.version);
  });

  it('keeps analysis_consent consistent with the latest history row under concurrent writes', async () => {
    const pool = await getTestPool();
    const user = await createUser(pool, 'a@example.com');

    await Promise.all([
      recordConsentChange(pool, user.id, true),
      recordConsentChange(pool, user.id, false),
    ]);

    const { rows } = await pool.query<{ analysis_consent: boolean }>(
      'SELECT analysis_consent FROM users WHERE id = $1',
      [user.id],
    );
    const history = await listConsentHistory(pool, user.id);
    expect(history).toHaveLength(2);
    expect(rows[0]?.analysis_consent).toBe(history[history.length - 1]?.granted);
  });
});
