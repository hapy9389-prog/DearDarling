#!/bin/bash
# SESSION_TOKEN_ENCRYPTION_KEY을 안전하게 교체한다.
# - 교체 전 EC2의 sessions.cognito_refresh_token_encrypted에 이 키로 암호화된 데이터가
#   있는지 SSH(postgres 피어 인증, 앱 비밀번호 불필요)로 먼저 확인한다. 0건이 아니면 절대
#   덮어쓰지 않고 중단한다.
# - 새 키는 저장소 밖 SECRETS_DIR(0700)의 0600 파일에만 잠깐 쓰고, sync-env.mjs로 apps/api/.env에
#   반영한 뒤 그 임시 파일을 지운다. 값은 어떤 단계에서도 출력하지 않는다.
#
# 사용법: ./infra/cognito/rotate-encryption-key.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/api/.env"
ENV_EXAMPLE="$REPO_ROOT/apps/api/.env.example"
SECRETS_DIR="/Users/tunib02/.deardarling-secrets-work"
SSH_KEY="$HOME/.ssh/deardarling-dev-ec2-key.pem"
EC2_HOST="ec2-user@13.125.155.80"

mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"

echo "[1/3] 암호화된 refresh token 보유 세션 수 확인 중(값 노출 없음)..."
set +e
RAW="$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$EC2_HOST" \
  "sudo -u postgres psql -X -qtA -d deardarling_dev -c \"SELECT count(*) FROM sessions WHERE cognito_refresh_token_encrypted IS NOT NULL;\"" 2>"$SECRETS_DIR/.ssh-err.tmp")"
SSH_RC=$?
set -e
COUNT="$(printf '%s' "$RAW" | tr -d '[:space:]')"
if [ -s "$SECRETS_DIR/.ssh-err.tmp" ]; then
  grep -v "post-quantum\|store now, decrypt later\|openssh.com/pq" "$SECRETS_DIR/.ssh-err.tmp" >&2 || true
fi
rm -f "$SECRETS_DIR/.ssh-err.tmp"

if [ "$SSH_RC" -ne 0 ] || ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then
  echo "카운트 조회 실패(SSH/DB 접속 문제로 보임) — 접속정보 노출 우려로 원본 오류는 위에서" \
       "필터링해 출력했습니다. 중단합니다." >&2
  exit 1
fi
echo "    암호화된 refresh token 보유 세션 수: $COUNT"
if [ "$COUNT" != "0" ]; then
  echo "0건이 아닙니다 — 기존 암호화 데이터를 복호화하지 못하게 될 수 있어 키를 교체하지 않고" \
       "중단합니다. 해당 세션들의 정리(로그아웃 처리 등) 방법을 먼저 정해야 합니다." >&2
  exit 1
fi

echo "[2/3] 새 키 생성 중..."
NEWKEY_FILE="$SECRETS_DIR/session-key.new"
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$NEWKEY_FILE"
chmod 600 "$NEWKEY_FILE"

echo "[3/3] apps/api/.env 반영 중..."
node "$SCRIPT_DIR/sync-env.mjs" "$ENV_FILE" "$ENV_EXAMPLE" "SESSION_TOKEN_ENCRYPTION_KEY=$NEWKEY_FILE"

echo "완료 — SESSION_TOKEN_ENCRYPTION_KEY 교체됨(값은 출력되지 않았습니다). 이전 값은 이제 .env에 없습니다."
