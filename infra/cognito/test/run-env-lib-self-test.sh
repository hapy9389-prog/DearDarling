#!/bin/bash
# env-lib.mjs(읽기)·sync-env.mjs(쓰기)가 apps/api/src/config/loadDotEnv.ts와 같은 규칙으로
# 동작하는지 검증한다 — 공백/따옴표가 있는 기존 설정, 중복 키, 키 보존, LOCAL_TEST_AUTH 판정.
# 전부 임시 파일에서만 동작한다. 서버 코드를 실행하지 않고 규칙만 비교한다.
set -uo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COGNITO_DIR="$(cd "$SELF_DIR/.." && pwd)"
PASS=0; FAIL=0

report() { if [ "$2" -eq 1 ]; then echo "PASS  $1"; PASS=$((PASS + 1)); else echo "FAIL  $1"; FAIL=$((FAIL + 1)); fi; }

work() { mktemp -d; }

# 1) 공백·따옴표가 있는 기존 값을 env-lib get이 서버와 같은 방식으로 읽는지
W="$(work)"
printf 'COGNITO_CLIENT_ID = "existing-value"\n' > "$W/.env"
GOT="$(node "$COGNITO_DIR/env-lib.mjs" get "$W/.env" COGNITO_CLIENT_ID)"
ok=1; [ "$GOT" = "existing-value" ] || ok=0
report "get-value-handles-spaces-and-quotes" "$ok"
rm -rf "$W"

# 2) 같은 키가 여러 번 있으면 "첫 번째" 값이 유효(서버 규칙)
W="$(work)"
printf 'KEY=first\nKEY=second\n' > "$W/.env"
GOT="$(node "$COGNITO_DIR/env-lib.mjs" get "$W/.env" KEY)"
ok=1; [ "$GOT" = "first" ] || ok=0
report "get-value-duplicate-keys-first-wins" "$ok"
rm -rf "$W"

# 3) sync-env가 "KEY = 기존값"(공백)을 새 줄 추가가 아니라 그 줄 교체로 처리하는지
W="$(work)"
mkdir -p "$W/apps/api"
printf 'NODE_ENV=development\nCOGNITO_CLIENT_ID = existing-value\nALLOWED_ORIGIN=http://127.0.0.1:3000\n' > "$W/apps/api/.env"
cp "$W/apps/api/.env" "$W/apps/api/.env.example"
VF="$W/newval.txt"; printf 'brand-new-id' > "$VF"
node "$COGNITO_DIR/sync-env.mjs" "$W/apps/api/.env" "$W/apps/api/.env.example" "COGNITO_CLIENT_ID=$VF" > "$W/sync.log" 2>&1
ok=1
[ "$(grep -c '^COGNITO_CLIENT_ID' "$W/apps/api/.env")" -eq 1 ] || ok=0
grep -qF 'COGNITO_CLIENT_ID=brand-new-id' "$W/apps/api/.env" || ok=0
GOT="$(node "$COGNITO_DIR/env-lib.mjs" get "$W/apps/api/.env" COGNITO_CLIENT_ID)"
[ "$GOT" = "brand-new-id" ] || ok=0
report "sync-env-replaces-spaced-existing-line-not-append" "$ok"
[ "$ok" -eq 1 ] || sed 's/^/  /' "$W/sync.log"
rm -rf "$W"

# 4) sync-env가 이미 파일 안에 중복으로 있는 줄들을 하나로 합치는지
W="$(work)"
mkdir -p "$W/apps/api"
printf 'KEY=old1\nOTHER=1\nKEY=old2\n' > "$W/apps/api/.env"
cp "$W/apps/api/.env" "$W/apps/api/.env.example"
VF="$W/newval.txt"; printf 'newvalue' > "$VF"
node "$COGNITO_DIR/sync-env.mjs" "$W/apps/api/.env" "$W/apps/api/.env.example" "KEY=$VF" > "$W/sync.log" 2>&1
ok=1
[ "$(grep -c '^KEY=' "$W/apps/api/.env")" -eq 1 ] || ok=0
grep -qF 'OTHER=1' "$W/apps/api/.env" || ok=0
report "sync-env-collapses-duplicate-lines-to-one" "$ok"
[ "$ok" -eq 1 ] || sed 's/^/  /' "$W/sync.log"
rm -rf "$W"

# 5) 무관한 기존 설정(공백·따옴표 포함)을 다른 키를 갱신할 때 건드리지 않는지
W="$(work)"
mkdir -p "$W/apps/api"
UNRELATED_LINE='DATABASE_URL = "postgres://u:p@127.0.0.1:5432/db"'
printf '%s\nNODE_ENV=development\n' "$UNRELATED_LINE" > "$W/apps/api/.env"
cp "$W/apps/api/.env" "$W/apps/api/.env.example"
VF="$W/newval.txt"; printf 'ap-northeast-2' > "$VF"
node "$COGNITO_DIR/sync-env.mjs" "$W/apps/api/.env" "$W/apps/api/.env.example" "COGNITO_REGION=$VF" > "$W/sync.log" 2>&1
ok=1
grep -qF "$UNRELATED_LINE" "$W/apps/api/.env" || ok=0
report "sync-env-preserves-unrelated-existing-setting-verbatim" "$ok"
[ "$ok" -eq 1 ] || sed 's/^/  /' "$W/sync.log"
rm -rf "$W"

# 6) LOCAL_TEST_AUTH 판정 — 공백·따옴표가 있어도 서버와 같은 문자열("true")로 정규화되는지
W="$(work)"
printf 'LOCAL_TEST_AUTH = "true"\n' > "$W/.env"
GOT="$(node "$COGNITO_DIR/env-lib.mjs" get "$W/.env" LOCAL_TEST_AUTH)"
ok=1; [ "$GOT" = "true" ] || ok=0
report "local-test-auth-quoted-spaced-normalizes-to-true" "$ok"
rm -rf "$W"

# 7) LOCAL_TEST_AUTH가 중복 정의됐을 때도 "첫 번째"(서버가 실제로 쓰는 값) 기준으로 판정하는지
W="$(work)"
printf 'LOCAL_TEST_AUTH=false\nLOCAL_TEST_AUTH=true\n' > "$W/.env"
GOT="$(node "$COGNITO_DIR/env-lib.mjs" get "$W/.env" LOCAL_TEST_AUTH)"
ok=1; [ "$GOT" = "false" ] || ok=0
report "local-test-auth-duplicate-uses-first-value" "$ok"
rm -rf "$W"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
