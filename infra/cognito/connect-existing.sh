#!/bin/bash
# Path B: 관리자(또는 콘솔 접근 권한이 있는 사람)가 이미 만들어 준 User Pool·App Client에
# "연결만" 한다 — 이 스크립트는 AWS를 전혀 호출하지 않으므로 실행하는 사람에게 어떤
# cognito-idp IAM 권한도 필요 없다. create-dev-pool.sh(Path A, 자동 생성)와는 완전히 분리된
# 별도 경로다 — 자동 생성 로직·상태 파일(state.local.json)을 전혀 건드리지 않는다.
#
# 값 입력은 전부 숨김 입력(비밀번호처럼 화면에 안 보임)으로 받는다 — Secret을 셸 인자로 넘기지
# 않는다. apps/api/.env는 sync-env.mjs와 동일한 원자적 방식(임시 파일 + rename)으로 갱신한다.
#
# 사용법: ./infra/cognito/connect-existing.sh

set -euo pipefail

EXPECTED_REGION="ap-northeast-2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ "${1:-}" = "--repo-root" ]; then REPO_ROOT="$(cd "$2" && pwd)"; fi
ENV_FILE="$REPO_ROOT/apps/api/.env"
ENV_EXAMPLE="$REPO_ROOT/apps/api/.env.example"
TMP_DIR="$(mktemp -d)"
chmod 700 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

read_hidden() { local v; read -r -s -p "$1" v; echo >&2; printf '%s' "$v"; }

echo "관리자에게 전달받은 값을 입력하세요(화면에 표시되지 않음)."
read -r -p "리전 [$EXPECTED_REGION]: " REGION_IN
REGION="${REGION_IN:-$EXPECTED_REGION}"
if [ "$REGION" != "$EXPECTED_REGION" ]; then
  echo "경고: 승인된 리전($EXPECTED_REGION)과 다릅니다($REGION) — 계속하려면 다시 확인하세요." >&2
  exit 1
fi

read -r -p "User Pool ID (예: ap-northeast-2_xxxxxxxxx): " POOL_ID
if ! [[ "$POOL_ID" =~ ^${REGION}_[A-Za-z0-9]+$ ]]; then
  echo "User Pool ID 형식이 예상과 다릅니다 — 다시 확인하세요." >&2
  exit 1
fi

read -r -p "App Client ID: " CLIENT_ID
if [ -z "$CLIENT_ID" ]; then
  echo "App Client ID가 비어 있습니다." >&2
  exit 1
fi

CLIENT_SECRET_FILE="$TMP_DIR/client-secret.txt"
printf '%s' "$(read_hidden "App Client Secret(화면에 표시 안 됨): ")" > "$CLIENT_SECRET_FILE"
chmod 600 "$CLIENT_SECRET_FILE"
if [ ! -s "$CLIENT_SECRET_FILE" ]; then
  echo "App Client Secret이 비어 있습니다." >&2
  exit 1
fi

echo "[SESSION_TOKEN_ENCRYPTION_KEY] 이미 apps/api/.env에 유효한 값이 있으면 그대로 둡니다."
NEW_ENC_KEY_FILE=""
# apps/api/src/config/loadDotEnv.ts와 같은 규칙으로 읽는다(공백·따옴표·중복 키 처리 일치).
EXISTING_KEY_LINE="$(node "$SCRIPT_DIR/env-lib.mjs" get "$ENV_FILE" SESSION_TOKEN_ENCRYPTION_KEY 2>/dev/null || true)"
if [ -n "$EXISTING_KEY_LINE" ]; then
  EKFILE="$TMP_DIR/existing-key.txt"
  printf '%s' "$EXISTING_KEY_LINE" > "$EKFILE"; chmod 600 "$EKFILE"
  unset EXISTING_KEY_LINE
  VALID="$(node -e "
    const fs=require('fs');
    const b=Buffer.from(fs.readFileSync(process.argv[1],'utf8'),'base64');
    console.log(b.length===32 ? 'yes':'no');
  " "$EKFILE")"
  rm -f "$EKFILE"
  if [ "$VALID" != "yes" ]; then
    echo "기존 SESSION_TOKEN_ENCRYPTION_KEY 형식이 잘못됐습니다 — 중단합니다. 직접 확인하세요." >&2
    exit 1
  fi
  echo "    기존 유효한 키를 유지합니다."
else
  NEW_ENC_KEY_FILE="$TMP_DIR/enc-key.txt"
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$NEW_ENC_KEY_FILE"
  chmod 600 "$NEW_ENC_KEY_FILE"
  echo "    없어서 새로 생성했습니다."
fi

names=(COGNITO_REGION COGNITO_USER_POOL_ID COGNITO_CLIENT_ID COGNITO_CLIENT_SECRET SESSION_TOKEN_ENCRYPTION_KEY)
found=()
for n in "${names[@]}"; do [ -n "${!n+x}" ] && found+=("$n"); done
if [ ${#found[@]} -gt 0 ]; then
  echo "주의: 이 셸에 이미 ${found[*]}이(가) 설정돼 있습니다 — apps/api 서버는 .env보다 셸에서" \
       "export된 값을 우선하므로, 지금부터 apps/api/.env에 쓰는 값이 서버 실행 시 무시될 수" \
       "있습니다. 서버를 실행할 셸에서 해당 변수를 unset하세요." >&2
fi

printf '%s' "$REGION" > "$TMP_DIR/region.txt"
printf '%s' "$POOL_ID" > "$TMP_DIR/pool-id.txt"
printf '%s' "$CLIENT_ID" > "$TMP_DIR/client-id.txt"
SYNC_ARGS=("COGNITO_REGION=$TMP_DIR/region.txt" "COGNITO_USER_POOL_ID=$TMP_DIR/pool-id.txt" "COGNITO_CLIENT_ID=$TMP_DIR/client-id.txt" "COGNITO_CLIENT_SECRET=$CLIENT_SECRET_FILE")
[ -n "$NEW_ENC_KEY_FILE" ] && SYNC_ARGS+=("SESSION_TOKEN_ENCRYPTION_KEY=$NEW_ENC_KEY_FILE")
node "$SCRIPT_DIR/sync-env.mjs" "$ENV_FILE" "$ENV_EXAMPLE" "${SYNC_ARGS[@]}"

echo "완료 — apps/api/.env에 반영했습니다(값은 출력하지 않음). AWS는 호출하지 않았습니다."
