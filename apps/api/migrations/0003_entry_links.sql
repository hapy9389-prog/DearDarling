-- 제한된 테스트 참여자용 입장 링크(entry link) — 이메일 가입·비밀번호·Cognito 없이
-- 운영자가 발급한 개인별 일회성·만료형 링크로 서버가 참여자를 구분한다.
-- (Cognito 정식 회원가입 계획은 보류 — 이 마이그레이션과 무관)

ALTER TABLE users ADD COLUMN IF NOT EXISTS note TEXT;                    -- 운영 메모(예: "커플1-A")
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_locked_at TIMESTAMPTZ;   -- 유출/분실 대응으로 차단된 적 있음(운영 참고용)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;                     -- 이메일 없이 참여 가능(닉네임으로 구분)

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- 쿠키 값
  user_id UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS entry_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,   -- sha256(원문 토큰) — 원문은 DB에 저장하지 않는다
  user_id UUID NOT NULL REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'revoked', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ
);

-- 한 사람당 아직 안 쓴 링크는 하나만 — 재발급 시 기존 pending 링크를 먼저 revoked로 바꾼 뒤 새로 만든다.
CREATE UNIQUE INDEX IF NOT EXISTS entry_links_one_pending_per_user
  ON entry_links (user_id)
  WHERE status = 'pending';

-- 요청 출처(IP) 기준 요청 제한. scope 예: 'entry-link-check', 'entry-link-redeem'.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  scope TEXT NOT NULL,
  source_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, source_key, window_start)
);
