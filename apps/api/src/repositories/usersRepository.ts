import type { Pool, PoolClient } from 'pg';

export interface UserRow {
  id: string;
  email: string;
  nickname: string | null;
  avatar_emoji: string | null;
  couple_id: string | null;
  analysis_consent: boolean;
  is_seed: boolean;
  created_at: Date;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/** 로컬 테스트 모드 전용 진입점(src/routes/testUsers.ts)에서만 호출된다 — 실제 가입은 아직 없다. */
export async function createUser(db: Queryable, email: string): Promise<UserRow> {
  const { rows } = await db.query<UserRow>('INSERT INTO users (email) VALUES ($1) RETURNING *', [
    email,
  ]);
  const row = rows[0];
  if (!row) throw new Error('사용자 생성에 실패했습니다.');
  return row;
}

export async function findUserById(db: Queryable, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function updateProfile(
  db: Queryable,
  userId: string,
  fields: { nickname?: string; avatarEmoji?: string },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `UPDATE users
     SET nickname = COALESCE($2, nickname), avatar_emoji = COALESCE($3, avatar_emoji)
     WHERE id = $1
     RETURNING *`,
    [userId, fields.nickname ?? null, fields.avatarEmoji ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error('사용자를 찾을 수 없습니다.');
  return row;
}
