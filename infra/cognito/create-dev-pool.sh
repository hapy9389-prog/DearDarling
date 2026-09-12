#!/bin/bash
# DearDarling 개발용 Cognito User Pool + App Client를 안전하게 준비한다(Path A: 자동 생성 스크립트).
#
# 핵심 규칙:
# - 목록 조회(List)가 실패하면(권한 부족·통신 오류 등 이유 불문) "없다"로 취급하지 않는다 —
#   중단한다. 이 스크립트를 쓰려면 List·Create·Describe 권한이 전부 필요하다(README 참고).
#   권한을 주고 싶지 않다면 이 스크립트 대신 connect-existing.sh(Path B)를 쓴다.
# - 자원을 "재사용"할 때는 그 출처(상태 파일이든 방금 List로 찾았든)에 관계없이 항상
#   Describe로 다시 검증한다 — Pool은 태그, Client는 소속 Pool 일치 여부와 Secret을 확인한다.
#   Describe가 안 되면(권한 부족 등) 검증 없이 재사용하지 않고 중단한다.
# - 이름이 같은 자원이 여러 개면 어떤 것도 임의로 고르지 않고 중단한다.
# - 생성 응답을 확인하지 못한 채 끝나면(네트워크 끊김 등) 다음 실행에서 자동 재시도하지 않고
#   사람 확인을 요구한다.
# - 기존 SESSION_TOKEN_ENCRYPTION_KEY는 형식(32바이트 base64)이 유효할 때만 보존한다 —
#   무효한 값을 발견하면 조용히 덮어쓰거나 그대로 두지 않고 중단한다.
# - ClientSecret · SESSION_TOKEN_ENCRYPTION_KEY 값은 어떤 단계에서도 화면에 출력하지 않고,
#   다른 프로세스의 명령줄 인자로도 넘기지 않는다(항상 임시 파일 경로만 인자로 넘긴다).
# - .env·상태 파일은 임시 파일에 전부 쓴 뒤 rename으로 교체한다(원자적).
#
# 사전 조건: aws configure --profile tunibridge 완료, README 4번의 생성 권한 부여됨.
# 사용법: ./infra/cognito/create-dev-pool.sh [--repo-root PATH]   (--repo-root는 자체 테스트 전용)

set -euo pipefail

EXPECTED_ACCOUNT_ID="539746929196"   # tunibaws
EXPECTED_REGION="ap-northeast-2"     # 서울

PROFILE="${AWS_PROFILE_OVERRIDE:-tunibridge}"
REGION="${AWS_REGION_OVERRIDE:-ap-northeast-2}"
POOL_NAME="deardarling-dev-user-pool"
CLIENT_NAME="deardarling-dev-api-server"
EXPECT_TAG_PROJECT="DearDarling"
EXPECT_TAG_ENV="dev"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ "${1:-}" = "--repo-root" ]; then REPO_ROOT="$(cd "$2" && pwd)"; fi

STATE_FILE="$SCRIPT_DIR/state.local.json"
ENV_FILE="$REPO_ROOT/apps/api/.env"
ENV_EXAMPLE="$REPO_ROOT/apps/api/.env.example"
TMP_DIR="$(mktemp -d)"
chmod 700 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

aws_cmd() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

state_get() {
  node -e "
    const s = JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8'));
    const v = s['$1']; process.stdout.write(v == null ? '' : String(v));
  "
}
state_set() {
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
    s['$1'] = $2;
    const tmp = '$STATE_FILE.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, '$STATE_FILE');
  "
}
state_del() {
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
    delete s['$1'];
    const tmp = '$STATE_FILE.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, '$STATE_FILE');
  "
}

echo "[1/6] 신원·계정·리전 확인 중..."
CALLER_JSON="$TMP_DIR/caller.json"
aws_cmd sts get-caller-identity --output json > "$CALLER_JSON"
ACCOUNT_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CALLER_JSON','utf8')).Account)")"
if [ "$ACCOUNT_ID" != "$EXPECTED_ACCOUNT_ID" ] || [ "$REGION" != "$EXPECTED_REGION" ]; then
  echo "승인된 회사 계정($EXPECTED_ACCOUNT_ID)/리전($EXPECTED_REGION)이 아닙니다" \
       "(현재: $ACCOUNT_ID/$REGION) — 중단합니다." >&2
  exit 1
fi
echo "    Account=$ACCOUNT_ID(확인됨) Region=$REGION(확인됨) Profile=$PROFILE"

[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

PREV_ACCOUNT="$(state_get accountId)"
PREV_REGION="$(state_get region)"
if [ -n "$PREV_ACCOUNT" ] && { [ "$PREV_ACCOUNT" != "$ACCOUNT_ID" ] || [ "$PREV_REGION" != "$REGION" ]; }; then
  echo "상태 파일의 계정/리전($PREV_ACCOUNT/$PREV_REGION)이 지금과 다릅니다 — 중단합니다." >&2
  exit 1
fi
state_set accountId "\"$ACCOUNT_ID\""
state_set region "\"$REGION\""

if [ -n "$(state_get pendingUserPoolCreateAt)" ] && [ -z "$(state_get userPoolId)" ]; then
  cat >&2 <<EOF
이전 실행이 User Pool 생성 요청 뒤 결과를 확인 못 한 채 끝났습니다. 자동 재시도는 중복 생성
위험이 있어 하지 않습니다. 다음을 확인한 뒤 진행하세요:
  1) aws cognito-idp list-user-pools --profile $PROFILE --region $REGION --max-results 60
     (또는 콘솔)에서 이름이 "$POOL_NAME"인 Pool이 실제로 만들어졌는지 확인
  2) 있다면 그 UserPoolId를 $STATE_FILE 의 "userPoolId"에 직접 채워 넣기
  3) 없다면 $STATE_FILE 에서 "pendingUserPoolCreateAt" 항목을 지우고 재실행
EOF
  exit 1
fi
if [ -n "$(state_get pendingUserPoolClientCreateAt)" ] && [ -z "$(state_get userPoolClientId)" ]; then
  cat >&2 <<EOF
이전 실행이 App Client 생성 요청 뒤 결과를 확인 못 한 채 끝났습니다. 다음을 확인하세요:
  1) aws cognito-idp list-user-pool-clients --user-pool-id "$(state_get userPoolId)" \\
     --profile $PROFILE --region $REGION 에서 이름이 "$CLIENT_NAME"인 Client가 실제로 있는지 확인
  2) 있다면 ClientId를 $STATE_FILE 의 "userPoolClientId"에 직접 채워 넣기(다음 단계에서
     describe-user-pool-client로 Secret을 다시 확보한다)
  3) 없다면 $STATE_FILE 에서 "pendingUserPoolClientCreateAt" 항목을 지우고 재실행
EOF
  exit 1
fi

# ── Pool 검증(재사용 시 출처에 관계없이 항상 호출) ─────────────────────────
describe_pool_or_abort() {
  local pid="$1"
  local dj="$TMP_DIR/describe-pool-$pid.json"
  if ! aws_cmd cognito-idp describe-user-pool --user-pool-id "$pid" --output json > "$dj" 2>"$TMP_DIR/dp.err"; then
    echo "Pool($pid) 정보를 describe-user-pool로 확인할 수 없습니다(권한 부족 또는 통신 오류) —" \
         "검증 없이 재사용하지 않고 중단합니다." >&2
    cat "$TMP_DIR/dp.err" >&2
    exit 1
  fi
  local ok
  ok="$(node -e "
    const d=JSON.parse(require('fs').readFileSync('$dj','utf8')).UserPool;
    const tags = d.UserPoolTags || {};
    console.log(tags.Project==='$EXPECT_TAG_PROJECT' && tags.Environment==='$EXPECT_TAG_ENV' ? 'yes':'no');
  ")"
  if [ "$ok" != "yes" ]; then
    echo "Pool($pid)의 태그가 기대(Project=$EXPECT_TAG_PROJECT, Environment=$EXPECT_TAG_ENV)와" \
         "다릅니다 — 다른 목적의 Pool일 수 있어 중단합니다." >&2
    exit 1
  fi
}

echo "[2/6] User Pool 확인 중..."
USER_POOL_ID="$(state_get userPoolId)"
if [ -n "$USER_POOL_ID" ]; then
  echo "    상태 파일에 기록된 Pool을 재검증합니다: $USER_POOL_ID"
  describe_pool_or_abort "$USER_POOL_ID"
else
  LIST_JSON="$TMP_DIR/list-pools.json"
  if ! aws_cmd cognito-idp list-user-pools --max-results 60 --output json > "$LIST_JSON" 2>"$TMP_DIR/lp.err"; then
    echo "list-user-pools 호출이 실패했습니다(권한 부족 또는 통신 오류) — 기존 자원이 있는지" \
         "확인할 수 없으므로 자동 생성을 하지 않고 중단합니다. 아래 오류를 확인하세요:" >&2
    cat "$TMP_DIR/lp.err" >&2
    exit 1
  fi
  MATCH_COUNT="$(node -e "
    const d=JSON.parse(require('fs').readFileSync('$LIST_JSON','utf8'));
    console.log((d.UserPools||[]).filter(p=>p.Name==='$POOL_NAME').length);
  ")"
  if [ "$MATCH_COUNT" -gt 1 ]; then
    echo "이름이 \"$POOL_NAME\"인 Pool이 $MATCH_COUNT 개 있어 어떤 걸 재사용할지 판단할 수" \
         "없습니다 — 중단합니다." >&2
    exit 1
  fi
  if [ "$MATCH_COUNT" -eq 1 ]; then
    FOUND_ID="$(node -e "
      const d=JSON.parse(require('fs').readFileSync('$LIST_JSON','utf8'));
      console.log((d.UserPools||[]).find(p=>p.Name==='$POOL_NAME').Id);
    ")"
    describe_pool_or_abort "$FOUND_ID"
    echo "    기존 Pool 재사용(태그 확인됨): $FOUND_ID"
    USER_POOL_ID="$FOUND_ID"
    state_set userPoolId "\"$USER_POOL_ID\""
  fi
fi
if [ -z "$USER_POOL_ID" ]; then
  echo "    새로 생성: $POOL_NAME"
  state_set pendingUserPoolCreateAt "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  CREATE_JSON="$TMP_DIR/create-pool.json"
  aws_cmd cognito-idp create-user-pool --pool-name "$POOL_NAME" \
    --cli-input-json "file://$SCRIPT_DIR/dev-user-pool.params.json" --output json > "$CREATE_JSON"
  USER_POOL_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CREATE_JSON','utf8')).UserPool.Id)")"
  state_set userPoolId "\"$USER_POOL_ID\""
  state_del pendingUserPoolCreateAt
  echo "    생성됨: $USER_POOL_ID"
fi

# ── Client 검증(재사용 시 항상 Describe로 소속 Pool·Secret을 다시 확인) ────
describe_client_or_abort() {  # $1=client id -> 성공 시 CLIENT_SECRET_FILE 설정, 실패 시 exit 1
  local cid="$1"
  local dj="$TMP_DIR/describe-client-$cid.json"
  if ! aws_cmd cognito-idp describe-user-pool-client --user-pool-id "$USER_POOL_ID" \
      --client-id "$cid" --output json > "$dj" 2>"$TMP_DIR/dc.err"; then
    echo "Client($cid) 정보를 describe-user-pool-client로 확인할 수 없습니다 — Secret도 이 호출로만" \
         "다시 얻을 수 있어 재사용을 포기하고 중단합니다." >&2
    cat "$TMP_DIR/dc.err" >&2
    exit 1
  fi
  chmod 600 "$dj"
  local rel_ok
  rel_ok="$(node -e "
    const d=JSON.parse(require('fs').readFileSync('$dj','utf8')).UserPoolClient;
    console.log(d.UserPoolId === '$USER_POOL_ID' ? 'yes':'no');
  ")"
  if [ "$rel_ok" != "yes" ]; then
    echo "Client($cid)가 지금 대상 Pool($USER_POOL_ID)이 아니라 다른 Pool 소속입니다 — 상태" \
         "정보가 오래됐을 수 있어 중단합니다." >&2
    exit 1
  fi
  CLIENT_SECRET_FILE="$TMP_DIR/client-secret-$cid.txt"
  node -e "
    const fs=require('fs');
    const d=JSON.parse(fs.readFileSync('$dj','utf8')).UserPoolClient;
    fs.writeFileSync('$CLIENT_SECRET_FILE', d.ClientSecret || '');
  "
  chmod 600 "$CLIENT_SECRET_FILE"
  if [ ! -s "$CLIENT_SECRET_FILE" ]; then
    echo "Client($cid)의 Secret을 응답에서 찾지 못했습니다 — 중단합니다." >&2
    exit 1
  fi
}

echo "[3/6] App Client 확인 중..."
CLIENT_ID="$(state_get userPoolClientId)"
NEW_CLIENT_SECRET_FILE=""
if [ -n "$CLIENT_ID" ]; then
  echo "    상태 파일에 기록된 Client를 재검증합니다: $CLIENT_ID"
  describe_client_or_abort "$CLIENT_ID"
  NEW_CLIENT_SECRET_FILE="$CLIENT_SECRET_FILE"
else
  LIST_C_JSON="$TMP_DIR/list-clients.json"
  if ! aws_cmd cognito-idp list-user-pool-clients --user-pool-id "$USER_POOL_ID" --max-results 60 --output json > "$LIST_C_JSON" 2>"$TMP_DIR/lc.err"; then
    echo "list-user-pool-clients 호출이 실패했습니다 — 기존 Client 유무를 확인할 수 없으므로" \
         "중단합니다." >&2
    cat "$TMP_DIR/lc.err" >&2
    exit 1
  fi
  MATCH_C_COUNT="$(node -e "
    const d=JSON.parse(require('fs').readFileSync('$LIST_C_JSON','utf8'));
    console.log((d.UserPoolClients||[]).filter(c=>c.ClientName==='$CLIENT_NAME').length);
  ")"
  if [ "$MATCH_C_COUNT" -gt 1 ]; then
    echo "이름이 \"$CLIENT_NAME\"인 Client가 $MATCH_C_COUNT 개 있어 중단합니다." >&2
    exit 1
  fi
  if [ "$MATCH_C_COUNT" -eq 1 ]; then
    FOUND_CID="$(node -e "
      const d=JSON.parse(require('fs').readFileSync('$LIST_C_JSON','utf8'));
      console.log((d.UserPoolClients||[]).find(c=>c.ClientName==='$CLIENT_NAME').ClientId);
    ")"
    describe_client_or_abort "$FOUND_CID"
    echo "    기존 App Client 재사용(소속 Pool 확인, Secret 재확보): $FOUND_CID"
    CLIENT_ID="$FOUND_CID"
    state_set userPoolClientId "\"$CLIENT_ID\""
    NEW_CLIENT_SECRET_FILE="$CLIENT_SECRET_FILE"
  fi
fi
if [ -z "$CLIENT_ID" ]; then
  echo "    새로 생성: $CLIENT_NAME"
  state_set pendingUserPoolClientCreateAt "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  CREATE_C_JSON="$TMP_DIR/create-client.json"
  aws_cmd cognito-idp create-user-pool-client --user-pool-id "$USER_POOL_ID" --client-name "$CLIENT_NAME" \
    --cli-input-json "file://$SCRIPT_DIR/dev-user-pool-client.params.json" --output json > "$CREATE_C_JSON"
  chmod 600 "$CREATE_C_JSON"
  CLIENT_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CREATE_C_JSON','utf8')).UserPoolClient.ClientId)")"
  state_set userPoolClientId "\"$CLIENT_ID\""
  state_del pendingUserPoolClientCreateAt
  NEW_CLIENT_SECRET_FILE="$TMP_DIR/client-secret.txt"
  node -e "
    const fs=require('fs');
    const r=JSON.parse(fs.readFileSync('$CREATE_C_JSON','utf8'));
    fs.writeFileSync('$NEW_CLIENT_SECRET_FILE', r.UserPoolClient.ClientSecret);
  "
  chmod 600 "$NEW_CLIENT_SECRET_FILE"
  echo "    생성됨: $CLIENT_ID (Secret은 출력하지 않음)"
fi

echo "[4/6] SESSION_TOKEN_ENCRYPTION_KEY 확인 중..."
NEW_ENC_KEY_FILE=""
# apps/api/src/config/loadDotEnv.ts와 같은 규칙(공백·따옴표·중복 키 처리)으로 읽는다 —
# 단순 sed(`^KEY=`)는 "KEY = 값"처럼 공백이 있으면 기존 값을 못 찾아 새 줄을 추가하고, 서버는
# 여전히 원래 줄(첫 번째)을 쓰는 불일치가 생긴다.
EXISTING_KEY_LINE="$(node "$SCRIPT_DIR/env-lib.mjs" get "$ENV_FILE" SESSION_TOKEN_ENCRYPTION_KEY 2>/dev/null || true)"
if [ -n "$EXISTING_KEY_LINE" ]; then
  EKFILE="$TMP_DIR/existing-key.txt"
  printf '%s' "$EXISTING_KEY_LINE" > "$EKFILE"
  chmod 600 "$EKFILE"
  unset EXISTING_KEY_LINE
  VALID="$(node -e "
    const fs=require('fs');
    const v=fs.readFileSync(process.argv[1],'utf8');
    const b=Buffer.from(v,'base64');
    console.log(b.length===32 ? 'yes':'no');
  " "$EKFILE")"
  rm -f "$EKFILE"
  if [ "$VALID" != "yes" ]; then
    echo "기존 SESSION_TOKEN_ENCRYPTION_KEY가 32바이트 base64 형식이 아닙니다 — 잘못된 값을" \
         "그대로 두거나 조용히 덮어쓰면 안전하지 않으므로 중단합니다. apps/api/.env를 직접" \
         "확인해 값을 고치거나 지운 뒤 재실행하세요." >&2
    exit 1
  fi
  echo "    이미 설정된 유효한 키를 유지합니다(값 출력 안 함)."
else
  echo "    없어서 새로 생성합니다."
  NEW_ENC_KEY_FILE="$TMP_DIR/enc-key.txt"
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$NEW_ENC_KEY_FILE"
  chmod 600 "$NEW_ENC_KEY_FILE"
fi

warn_if_shell_overrides() {
  # apps/api의 loadDotEnv는 셸에 이미 export된 값을 .env보다 우선한다 — 지금 이 셸에 이 값들이
  # 이미 설정돼 있으면, 앞으로 apps/api/.env에 쓰는 값이 실제 서버 실행 시 무시될 수 있다.
  local names=(COGNITO_REGION COGNITO_USER_POOL_ID COGNITO_CLIENT_ID COGNITO_CLIENT_SECRET SESSION_TOKEN_ENCRYPTION_KEY)
  local found=()
  for n in "${names[@]}"; do
    [ -n "${!n+x}" ] && found+=("$n")
  done
  if [ ${#found[@]} -gt 0 ]; then
    echo "주의: 이 셸에 이미 ${found[*]}이(가) 설정돼 있습니다 — apps/api 서버는 .env보다 셸에서" \
         "export된 값을 우선하므로, 지금부터 apps/api/.env에 쓰는 값이 서버 실행 시 무시될 수" \
         "있습니다. 서버를 실행할 셸에서 해당 변수를 unset하세요." >&2
  fi
}
warn_if_shell_overrides

echo "[5/6] apps/api/.env 반영 중..."
printf '%s' "$REGION" > "$TMP_DIR/region.txt"
printf '%s' "$USER_POOL_ID" > "$TMP_DIR/pool-id.txt"
printf '%s' "$CLIENT_ID" > "$TMP_DIR/client-id.txt"
SYNC_ARGS=("COGNITO_REGION=$TMP_DIR/region.txt" "COGNITO_USER_POOL_ID=$TMP_DIR/pool-id.txt" "COGNITO_CLIENT_ID=$TMP_DIR/client-id.txt")
[ -n "$NEW_CLIENT_SECRET_FILE" ] && SYNC_ARGS+=("COGNITO_CLIENT_SECRET=$NEW_CLIENT_SECRET_FILE")
[ -n "$NEW_ENC_KEY_FILE" ] && SYNC_ARGS+=("SESSION_TOKEN_ENCRYPTION_KEY=$NEW_ENC_KEY_FILE")
node "$SCRIPT_DIR/sync-env.mjs" "$ENV_FILE" "$ENV_EXAMPLE" "${SYNC_ARGS[@]}"

echo "[6/6] 최종 확인 중..."
# apps/api/src/config/loadDotEnv.ts와 같은 규칙으로 읽는다 — 단순 정규식(`^KEY=`)은 값에
# 공백·따옴표가 있는 유효한 기존 설정을 "없음"으로 오판해, 실제로는 다 채워졌는데도 성공으로
# 보고하지 못하고 중단하는 문제가 있었다.
MISSING="$(node -e "
  (async () => {
    const { getEffectiveValue } = await import('file://$SCRIPT_DIR/env-lib.mjs');
    const need = ['COGNITO_REGION','COGNITO_USER_POOL_ID','COGNITO_CLIENT_ID','COGNITO_CLIENT_SECRET','SESSION_TOKEN_ENCRYPTION_KEY'];
    const missing = need.filter((k) => !getEffectiveValue('$ENV_FILE', k));
    const region = getEffectiveValue('$ENV_FILE', 'COGNITO_REGION');
    if (region && region !== '$EXPECTED_REGION') missing.push('COGNITO_REGION(값 불일치)');
    console.log(missing.join(','));
  })();
")"
if [ -n "$MISSING" ]; then
  echo "필수 설정이 빠졌거나 맞지 않습니다: $MISSING — 성공으로 보고하지 않습니다." >&2
  exit 1
fi
echo "완료 — UserPoolId=$USER_POOL_ID ClientId=$CLIENT_ID"
echo "(ClientSecret / SESSION_TOKEN_ENCRYPTION_KEY 값은 출력되지 않았습니다.)"
