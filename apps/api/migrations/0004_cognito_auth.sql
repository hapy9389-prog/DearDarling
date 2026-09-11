-- Cognito 기반 회원가입·로그인 도입. 추가만 한다 — 기존 컬럼·테이블·데이터는 지우지 않는다.
-- entry_links, users.note, users.auth_locked_at은 더 이상 실행 경로에서 쓰이지 않지만 보존한다.
-- users.email은 여전히 NULL 허용으로 둔다(0003이 적용된 적 없는 DB와도 안전하게 호환되도록).

ALTER TABLE users ADD COLUMN IF NOT EXISTS cognito_sub TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

-- 이 세션이 "어느 인증 세대"에 만들어졌는지 — 접근 차단을 실시간으로 판단하는 핵심(계획 §3-1·§3-2).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_with_auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cognito_refresh_token_encrypted BYTEA;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cognito_cleanup_pending BOOLEAN NOT NULL DEFAULT false;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 비밀번호 재설정 복구의 내구성 있는 기록(계획 §3-3·§3-4). user_id는 NULL 허용 — Cognito 가입은
-- 됐지만 로컬 사용자 행이 아직 없을 때의 재설정도 기록해야 한다. 비밀번호·인증 코드는 어떤
-- 컬럼에도 저장하지 않는다 — 복구는 상태 전이만으로 한다.
CREATE TABLE IF NOT EXISTS password_reset_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users (id),
  email TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'confirmed', 'failed', 'unknown', 'assumed')),
  outcome_recorded_at TIMESTAMPTZ,
  target_auth_version INTEGER,
  sessions_revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS password_reset_recoveries_email_idx ON password_reset_recoveries (email);
CREATE INDEX IF NOT EXISTS password_reset_recoveries_open_idx
  ON password_reset_recoveries (email)
  WHERE outcome IN ('pending', 'unknown', 'assumed') OR target_auth_version IS NULL;

-- Cognito로 전환하면서, 이전(입장 링크) 방식으로 만들어졌을 수 있는 기존 세션·미사용 링크를
-- "삭제"가 아니라 "무효화"만 한다 — 행은 그대로 남기고 인증에는 더 이상 쓰이지 않게 한다.
-- 0003이 적용된 적 없는 DB에서는 두 UPDATE 모두 대상 0건으로 아무 일도 하지 않는다.
UPDATE sessions SET revoked_at = clock_timestamp() WHERE revoked_at IS NULL;
UPDATE entry_links SET status = 'revoked' WHERE status = 'pending';
