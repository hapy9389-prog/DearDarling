#!/bin/bash
# create-dev-pool.sh를 실제 AWS 없이 검증한다. 전부 mktemp 임시 디렉터리 안에서만 동작하고
# 실행 후 삭제된다 — 저장소의 실제 apps/api/.env는 절대 건드리지 않는다.
set -uo pipefail  # -e는 안 씀 — 각 케이스의 실패 여부를 직접 판정해야 해서
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COGNITO_DIR="$(cd "$SELF_DIR/.." && pwd)"
PASS=0; FAIL=0

setup_work() {
  local WORK; WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo/apps/api" "$WORK/bin" "$WORK/repo/infra/cognito"
  cp "$SELF_DIR/fake-aws" "$WORK/bin/aws"; chmod +x "$WORK/bin/aws"
  cp "$COGNITO_DIR/create-dev-pool.sh" "$COGNITO_DIR/sync-env.mjs" "$COGNITO_DIR/env-lib.mjs" \
     "$COGNITO_DIR/dev-user-pool.params.json" "$COGNITO_DIR/dev-user-pool-client.params.json" \
     "$WORK/repo/infra/cognito/"
  cat > "$WORK/repo/apps/api/.env.example" <<'EOF'
NODE_ENV=development
DATABASE_URL=postgres://example
ALLOWED_ORIGIN=http://127.0.0.1:3000
EOF
  printf '%s' "$WORK"
}

run_once() {  # $1=WORK $2=FAKE_AWS_MODE
  local WORK="$1" mode="$2"
  PATH="$WORK/bin:$PATH" FAKE_AWS_MODE="$mode" FAKE_AWS_CALL_LOG="$WORK/calls.log" \
    AWS_PROFILE_OVERRIDE=tunibridge AWS_REGION_OVERRIDE=ap-northeast-2 \
    bash "$WORK/repo/infra/cognito/create-dev-pool.sh" --repo-root "$WORK/repo" \
    > "$WORK/run.log" 2>&1
}

call_count() {  # $1=WORK $2=부분일치 패턴 -> 표준출력으로 개수
  local f="$1/calls.log" n
  if [ -f "$f" ]; then n="$(grep -c -- "$2" "$f")"; else n=0; fi
  printf '%s' "$n"
}

report() {  # $1=이름 $2=WORK $3=0/1(성공 여부)
  if [ "$3" -eq 1 ]; then
    echo "PASS  $1"; PASS=$((PASS+1))
  else
    echo "FAIL  $1"; FAIL=$((FAIL+1))
    echo "  --- run.log ---"; sed 's/^/  /' "$2/run.log" 2>/dev/null
    echo "  --- calls.log ---"; sed 's/^/  /' "$2/calls.log" 2>/dev/null
  fi
  rm -rf "$2"
}

# 1) list 거부, 상태 없음 -> 중단, create 재호출 안 됨
W="$(setup_work)"; run_once "$W" list_denied; RC=$?
ok=1
[ "$RC" -eq 0 ] && ok=0
[ "$(call_count "$W" 'create-user-pool ')" -eq 0 ] || ok=0
grep -q "확인할 수 없으므로" "$W/run.log" || ok=0
report "list-denied-no-state-must-abort" "$W" "$ok"

# 2) 생성 응답 유실 -> 재실행 시 create-user-pool 재호출 안 되고 여전히 중단
W="$(setup_work)"
run_once "$W" create_lost_response          # 1차: 실패 예상(무시)
run_once "$W" happy_path; RC=$?             # 2차: pending marker 때문에 중단해야 함
ok=1
[ "$RC" -eq 0 ] && ok=0
[ "$(call_count "$W" 'create-user-pool ')" -eq 1 ] || ok=0   # 1차 1회만, 2차 재호출 없음
PENDING_LEFT="$(node -e "
  try { const s=JSON.parse(require('fs').readFileSync('$W/repo/infra/cognito/state.local.json','utf8'));
        console.log(s.pendingUserPoolCreateAt ? 'yes':'no'); }
  catch { console.log('no'); }
")"
[ "$PENDING_LEFT" = "yes" ] || ok=0
report "create-lost-response-rerun-no-duplicate" "$W" "$ok"

# 3) 이름 중복 다수 -> 중단
W="$(setup_work)"; run_once "$W" reuse_multi_match; RC=$?
ok=1; [ "$RC" -eq 0 ] && ok=0
report "reuse-multiple-name-matches-abort" "$W" "$ok"

# 4) 태그 불일치 -> 중단
W="$(setup_work)"; run_once "$W" reuse_tag_mismatch; RC=$?
ok=1; [ "$RC" -eq 0 ] && ok=0
report "reuse-tag-mismatch-abort" "$W" "$ok"

# 5) 기존 Client의 Secret을 describe로 확보 못함 -> 중단, .env에 Secret 기록 안 됨
W="$(setup_work)"; run_once "$W" reuse_client_describe_denied; RC=$?
ok=1; [ "$RC" -eq 0 ] && ok=0
[ -f "$W/repo/apps/api/.env" ] && grep -q '^COGNITO_CLIENT_SECRET=' "$W/repo/apps/api/.env" && ok=0
report "reuse-client-describe-denied-abort" "$W" "$ok"

# 6) Client가 실제로는 다른 Pool 소속 -> 중단, 잘못된 Secret이 .env에 안 들어감
W="$(setup_work)"; run_once "$W" reuse_client_wrong_pool; RC=$?
ok=1; [ "$RC" -eq 0 ] && ok=0
grep -q 'SHOULDNOTUSE' "$W/repo/apps/api/.env" 2>/dev/null && ok=0
report "reuse-client-wrong-pool-abort" "$W" "$ok"

# 7) 완전한 재사용 성공(태그·관계·Secret 모두 Describe로 확인) -> 성공
W="$(setup_work)"; run_once "$W" reuse_success; RC=$?
ok=1; [ "$RC" -ne 0 ] && ok=0
grep -q '^COGNITO_CLIENT_SECRET=REUSEDSECRETVALUE$' "$W/repo/apps/api/.env" 2>/dev/null || ok=0
grep -q '^COGNITO_USER_POOL_ID=ap-northeast-2_REUSED$' "$W/repo/apps/api/.env" 2>/dev/null || ok=0
report "reuse-success-with-full-verification" "$W" "$ok"

# 8) 기존 유효 암호화 키 보존(덮어쓰지 않음, 중복 줄 없음)
W="$(setup_work)"
GENKEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
printf 'SESSION_TOKEN_ENCRYPTION_KEY=%s\n' "$GENKEY" > "$W/repo/apps/api/.env"
run_once "$W" happy_path; RC=$?
ok=1; [ "$RC" -ne 0 ] && ok=0
grep -qF "SESSION_TOKEN_ENCRYPTION_KEY=$GENKEY" "$W/repo/apps/api/.env" 2>/dev/null || ok=0
[ "$(grep -c '^SESSION_TOKEN_ENCRYPTION_KEY=' "$W/repo/apps/api/.env" 2>/dev/null)" -eq 1 ] || ok=0
report "preserve-existing-valid-encryption-key" "$W" "$ok"

# 9) 기존 암호화 키가 잘못된 형식 -> 중단(치환도 방치도 하지 않음)
W="$(setup_work)"
printf 'SESSION_TOKEN_ENCRYPTION_KEY=not-32-bytes\n' > "$W/repo/apps/api/.env"
run_once "$W" happy_path; RC=$?
ok=1; [ "$RC" -eq 0 ] && ok=0
report "invalid-existing-encryption-key-must-abort" "$W" "$ok"

# 10) 처음부터 새로 생성(성공), 키 중복 없음
W="$(setup_work)"; run_once "$W" happy_path; RC=$?
ok=1; [ "$RC" -ne 0 ] && ok=0
grep -q '^COGNITO_CLIENT_SECRET=FAKESECRETVALUE$' "$W/repo/apps/api/.env" 2>/dev/null || ok=0
[ "$(grep -c '^COGNITO_USER_POOL_ID=' "$W/repo/apps/api/.env" 2>/dev/null)" -eq 1 ] || ok=0
[ "$(grep -c '^COGNITO_CLIENT_SECRET=' "$W/repo/apps/api/.env" 2>/dev/null)" -eq 1 ] || ok=0
report "happy-path-fresh-create" "$W" "$ok"

# 11) 공백·따옴표가 있는 유효한 기존 키 -> 보존되고 [6/6] 최종 확인까지 성공해야 함
# (정규식/Object.fromEntries로 .env를 읽으면 이 형태를 "없음"으로 오판해 6단계에서 잘못 중단했다)
W="$(setup_work)"
QUOTEDKEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
printf 'SESSION_TOKEN_ENCRYPTION_KEY = "%s"\n' "$QUOTEDKEY" > "$W/repo/apps/api/.env"
run_once "$W" happy_path; RC=$?
ok=1
[ "$RC" -eq 0 ] || ok=0
grep -qF "SESSION_TOKEN_ENCRYPTION_KEY = \"$QUOTEDKEY\"" "$W/repo/apps/api/.env" 2>/dev/null || ok=0
grep -q '^완료 — UserPoolId=' "$W/run.log" || ok=0
report "preserve-quoted-spaced-key-final-check-succeeds" "$W" "$ok"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
