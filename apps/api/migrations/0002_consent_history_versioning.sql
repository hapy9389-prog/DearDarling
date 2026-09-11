-- 동의 이력의 순서를 트랜잭션 시작 시각(now())이 아니라 사용자별 증가 버전 번호로
-- 보장한다. now()는 트랜잭션이 "시작된" 시각을 돌려주므로, 나중에 시작했지만 먼저
-- 잠금을 획득·커밋한 요청이 생기면(행 잠금으로 실제 처리 순서는 보장돼도) changed_at
-- 기준 정렬이 실제 처리 순서와 어긋날 수 있었다.
--
-- 기존 데이터는 지우지 않는다 — consent_events가 이미 있다면 각 사용자 안에서
-- changed_at(동률이면 id) 순서를 최선으로 삼아 1부터 버전을 매기고,
-- users.consent_version은 그 사용자의 최댓값 버전으로 맞춘다.

ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE consent_events ADD COLUMN IF NOT EXISTS version INTEGER;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY changed_at, id) AS rn
  FROM consent_events
)
UPDATE consent_events
SET version = ranked.rn
FROM ranked
WHERE consent_events.id = ranked.id;

ALTER TABLE consent_events ALTER COLUMN version SET NOT NULL;

UPDATE users
SET consent_version = latest.max_version
FROM (
  SELECT user_id, max(version) AS max_version
  FROM consent_events
  GROUP BY user_id
) AS latest
WHERE users.id = latest.user_id;

-- 같은 사용자 안에서 버전은 유일해야 한다 — recordConsentChange가 잠금 아래에서
-- 순차적으로 채우므로 정상 동작에서는 절대 충돌하지 않지만, 방어적으로 강제한다.
CREATE UNIQUE INDEX IF NOT EXISTS consent_events_user_version_idx ON consent_events (user_id, version);
