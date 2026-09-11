-- 프로필·초대·커플 연결·동의 이력을 위한 기본 스키마.
-- 실제 인증(Cognito)은 아직 연결하지 않았다 — users 행은 지금 단계에서
-- 로컬 테스트 모드 전용 엔드포인트(src/routes/testUsers.ts)로만 만들어진다.

CREATE TABLE IF NOT EXISTS couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  relationship_start_date DATE,
  is_seed BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  nickname TEXT,
  avatar_emoji TEXT,
  couple_id UUID REFERENCES couples (id),
  analysis_consent BOOLEAN NOT NULL DEFAULT false,
  is_seed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  inviter_user_id UUID NOT NULL REFERENCES users (id),
  accepted_by_user_id UUID REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

-- 사용자당 활성(pending) 초대는 하나만 — 부분 유니크 인덱스.
-- 만료된 초대는 발급 직전 지연 처리로 status='expired'로 바뀌므로 이 인덱스에 걸리지 않는다
-- (src/services/inviteService.ts의 expireStalePendingInvites 참고).
CREATE UNIQUE INDEX IF NOT EXISTS invites_one_pending_per_inviter
  ON invites (inviter_user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  granted BOOLEAN NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consent_events_user_id_idx ON consent_events (user_id);
