#!/bin/bash
# 기존 App Client ID를 유지한 채 새 Cognito Client Secret을 추가하고 apps/api/.env에 반영한다.
# 이전 Secret은 지우지 않는다(최대 2개 동시 활성 가능 — 무중단 교체). 이전 Secret은 실제 로그인
# 검증이 끝난 뒤 remove-old-client-secret.sh로 별도 삭제한다.
# - AddUserPoolClientSecret 응답(Secret 값 포함)은 저장소 밖 SECRETS_DIR(0700)의 0600 파일에만
#   쓰고 화면에 출력하지 않는다.
#
# 사용법: ./infra/cognito/add-client-secret.sh
set -euo pipefail
PROFILE="tunibridge"
REGION="ap-northeast-2"
USER_POOL_ID="ap-northeast-2_KsD6f5gio"
CLIENT_ID="69csra3gm8mbsg8tcu51tdj4rb"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/api/.env"
ENV_EXAMPLE="$REPO_ROOT/apps/api/.env.example"
SECRETS_DIR="/Users/tunib02/.deardarling-secrets-work"
mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"

aws_cmd() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

echo "[1/3] 새 Client Secret 추가 요청 중(응답은 화면에 출력하지 않음)..."
RESP_FILE="$SECRETS_DIR/add-secret-response.json"
if ! aws_cmd cognito-idp add-user-pool-client-secret \
    --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" \
    --output json > "$RESP_FILE" 2>"$SECRETS_DIR/.add-err.tmp"; then
  echo "Secret 추가 실패 — 권한 부족이거나 API 오류일 수 있습니다. 아래 오류를 확인하세요" \
       "(값은 포함돼 있지 않아야 하지만 확인 바랍니다):" >&2
  cat "$SECRETS_DIR/.add-err.tmp" >&2
  rm -f "$SECRETS_DIR/.add-err.tmp" "$RESP_FILE"
  exit 1
fi
rm -f "$SECRETS_DIR/.add-err.tmp"
chmod 600 "$RESP_FILE"

NEW_SECRET_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).ClientSecretDescriptor.ClientSecretId)" "$RESP_FILE")"
NEW_SECRET_FILE="$SECRETS_DIR/client-secret.new"
node -e "
  const fs=require('fs');
  const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  fs.writeFileSync(process.argv[2], r.ClientSecretDescriptor.ClientSecretValue);
" "$RESP_FILE" "$NEW_SECRET_FILE"
chmod 600 "$NEW_SECRET_FILE"
rm -f "$RESP_FILE"
echo "    새 Secret 추가됨(SecretId만 기록, 값은 출력 안 함): $NEW_SECRET_ID"
echo "$NEW_SECRET_ID" > "$SECRETS_DIR/new-secret-id.txt"
chmod 600 "$SECRETS_DIR/new-secret-id.txt"

echo "[2/3] apps/api/.env 반영 중..."
node "$SCRIPT_DIR/sync-env.mjs" "$ENV_FILE" "$ENV_EXAMPLE" "COGNITO_CLIENT_SECRET=$NEW_SECRET_FILE"

echo "[3/3] 현재 활성 Secret 목록 확인 중(값은 응답에 없음, 안전하게 출력)..."
aws_cmd cognito-idp list-user-pool-client-secrets \
  --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" --output json

echo "완료 — 새 Secret이 apps/api/.env에 반영됐습니다. 이전 Secret은 아직 살아있습니다(무중단)."
echo "새 SecretId(값 아님, 참고용 기록): $SECRETS_DIR/new-secret-id.txt"
echo "실제 로그인 검증이 끝난 뒤에만 이전 Secret을 remove-old-client-secret.sh로 삭제하세요."
