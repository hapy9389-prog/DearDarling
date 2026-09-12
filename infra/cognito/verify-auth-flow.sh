#!/bin/bash
# infra/cognito/verify-auth-flow.sh
# 실제 Cognito 연동 후 회원가입~로그아웃까지 검증한다.
# - 비밀번호·인증 코드는 숨김 입력(read -s)으로만 받고, 이후 Node/psql 등 외부 프로세스에는
#   항상 "값이 든 임시 파일 경로"만 인자로 넘긴다(값 자체를 인자로 넘기지 않는다).
# - .env를 읽을 때는 apps/api/src/config/loadDotEnv.ts와 같은 규칙(공백·따옴표·중복 키 처리)을
#   쓴다(env-lib.mjs) — sed 정규식은 서버가 읽는 방식과 달라질 수 있어 쓰지 않는다.
# - curl은 상태 코드 + 필요한 JSON 필드만 확인한다 — 응답 본문 전체·헤더(Set-Cookie 포함)는
#   출력하지 않는다. 실제 API 계약(logout·logout-all은 204, 나머지는 200)에 맞춘 상태 코드만
#   허용한다.
# - 인증 흐름(1~9단계)과 DB 정리 확인(10단계)의 결과를 구분해서 보고한다 — DB 쪽을 확인할 수
#   없다고 해서 전체를 실패로 만들지 않고, 반대로 확인 못 한 것을 완료로 보고하지도 않는다.
#
# 사용법: ./infra/cognito/verify-auth-flow.sh [--repo-root PATH]  (--repo-root는 자체 테스트 전용)
# 사전조건: apps/api에서 pnpm dev가 이미 떠 있고, .env의 LOCAL_TEST_AUTH가 true가 아님.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ "${1:-}" = "--repo-root" ]; then REPO_ROOT="$(cd "$2" && pwd)"; fi
ENV_FILE="$REPO_ROOT/apps/api/.env"

BASE="http://127.0.0.1:3000"
ORIGIN="http://127.0.0.1:3000"
POLL_ATTEMPTS="${CLEANUP_POLL_ATTEMPTS:-5}"
POLL_INTERVAL_SECONDS="${CLEANUP_POLL_INTERVAL_SECONDS:-30}"

WORKDIR="$(mktemp -d)"; chmod 700 "$WORKDIR"
JAR="$WORKDIR/session-a.cookies"; : > "$JAR"; chmod 600 "$JAR"
JAR2="$WORKDIR/session-b.cookies"; : > "$JAR2"; chmod 600 "$JAR2"
trap 'rm -rf "$WORKDIR"' EXIT

[ -f "$ENV_FILE" ] || { echo "실패: .env가 없습니다: $ENV_FILE" >&2; exit 1; }
DATABASE_URL="$(node "$SCRIPT_DIR/env-lib.mjs" get "$ENV_FILE" DATABASE_URL 2>/dev/null || true)"
LOCAL_TEST_AUTH_VAL="$(node "$SCRIPT_DIR/env-lib.mjs" get "$ENV_FILE" LOCAL_TEST_AUTH 2>/dev/null || true)"
if [ "${LOCAL_TEST_AUTH_VAL:-false}" = "true" ]; then
  echo "실패: LOCAL_TEST_AUTH=true입니다 — 실제 Cognito 검증에서는 꺼 두세요(.env)." >&2
  exit 1
fi

fail() { echo "실패: $1" >&2; exit 1; }
ok() { echo "OK: $1"; }

read_hidden_to_file() {  # $1=prompt $2=저장할 임시파일 경로(호출부가 미리 mktemp+chmod 600 해 둔다)
  local v
  read -r -s -p "$1" v
  echo >&2
  printf '%s' "$v" > "$2"
  unset v
}
new_secret_file() { local f; f="$(mktemp "$WORKDIR/val.XXXXXX")"; chmod 600 "$f"; printf '%s' "$f"; }

# key=파일경로 ... 를 JSON으로 합쳐 임시 파일(600) 경로를 반환한다 — 값 자체는 인자로 넘기지 않는다.
payload_file() {
  local out; out="$(mktemp "$WORKDIR/payload.XXXXXX")"; chmod 600 "$out"
  OUT="$out" node -e '
    const fs = require("fs");
    const obj = {};
    for (const p of process.argv.slice(1)) {
      const i = p.indexOf("=");
      obj[p.slice(0, i)] = fs.readFileSync(p.slice(i + 1), "utf8");
    }
    fs.writeFileSync(process.env.OUT, JSON.stringify(obj));
  ' "$@"
  printf '%s' "$out"
}
post_json_file() {  # $1=경로 $2=JAR $3=payload파일 -> HTTP 상태코드(표준출력), 본문은 $WORKDIR/last-body.json
  curl -s -o "$WORKDIR/last-body.json" -w '%{http_code}' -c "$2" -b "$2" \
    -H "Origin: $ORIGIN" -H "Content-Type: application/json" --data "@$3" "$BASE$1"
}
get_status() { curl -s -o "$WORKDIR/last-body.json" -w '%{http_code}' -b "$2" "$BASE$1"; }
post_empty() { curl -s -o /dev/null -w '%{http_code}' -c "$2" -b "$2" -H "Origin: $ORIGIN" -X POST "$BASE$1"; }

# 응답 본문(JSON)의 한 필드가 기대값과 문자열로 일치하는지만 확인한다 — 본문 전체는 출력하지 않는다.
assert_json_field() {  # $1=필드명 $2=기대값(문자열)
  local got
  got="$(node -e '
    const fs=require("fs");
    let body={};
    try { body = JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch {}
    console.log(String(body[process.argv[2]]));
  ' "$WORKDIR/last-body.json" "$1")"
  [ "$got" = "$2" ]
}

EMAILFILE="$(new_secret_file)"
read -r -p "테스트용 실제 수신 가능 이메일: " EMAIL_INPUT
printf '%s' "$EMAIL_INPUT" > "$EMAILFILE"

echo "=== 1) 회원가입 ==="
PWFILE="$(new_secret_file)"; read_hidden_to_file "비밀번호(화면에 표시 안 됨): " "$PWFILE"
P="$(payload_file "email=$EMAILFILE" "password=$PWFILE")"
CODE=$(post_json_file /api/auth/signup "$JAR" "$P"); rm -f "$P" "$PWFILE"
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] || fail "회원가입 HTTP $CODE (기대: 2xx)"
ok "회원가입 요청 접수(HTTP $CODE)"

echo "=== 2) 이메일 인증 코드 확인 ==="
echo "[직접 확인] 받은편지함(no-reply@verificationemail.com, 스팸함 포함)에서 코드를 확인하세요."
CODEFILE="$(new_secret_file)"; read_hidden_to_file "인증 코드(화면에 표시 안 됨): " "$CODEFILE"
P="$(payload_file "email=$EMAILFILE" "code=$CODEFILE")"
CODE=$(post_json_file /api/auth/confirm-signup "$JAR" "$P"); rm -f "$P" "$CODEFILE"
[ "$CODE" = "200" ] || fail "이메일 인증 HTTP $CODE (기대: 200)"
ok "이메일 인증 완료"

echo "=== 3) 로그인 ==="
PWFILE="$(new_secret_file)"; read_hidden_to_file "비밀번호 다시 입력: " "$PWFILE"
P="$(payload_file "email=$EMAILFILE" "password=$PWFILE")"
CODE=$(post_json_file /api/auth/login "$JAR" "$P"); rm -f "$P" "$PWFILE"
[ "$CODE" = "200" ] || fail "로그인 HTTP $CODE (기대: 200)"
ok "로그인 성공"

echo "=== 4) 로그인 상태 조회 ==="
CODE=$(get_status /api/auth/me "$JAR")
[ "$CODE" = "200" ] && assert_json_field authenticated true || fail "로그인 상태 조회 실패(HTTP $CODE, authenticated=true 기대)"
ok "로그인 상태 확인됨(authenticated=true)"

# 서버가 만료 지시를 내리기 전, 지금 유효한 세션 쿠키 원문을 임시(600) 파일로만 보관해 둔다 —
# 화면에는 출력하지 않는다. 5)에서 로그아웃한 뒤, 이 "예전 값"이 여전히 통하는지 확인하기 위해서다.
OLD_COOKIE_LINE="$(awk -F'\t' '$6=="dd_session"{print}' "$JAR" | tail -1 || true)"
STALE_JAR="$WORKDIR/stale.cookies"
if [ -n "$OLD_COOKIE_LINE" ]; then
  { echo '# Netscape HTTP Cookie File'; printf '%s\n' "$OLD_COOKIE_LINE"; } > "$STALE_JAR"
  chmod 600 "$STALE_JAR"
fi
unset OLD_COOKIE_LINE

echo "=== 5) 로그아웃 ==="
# 실제 API 계약: /api/auth/logout 성공은 204(본문 없음) — apps/api/src/routes/auth.ts 참고.
CODE=$(post_empty /api/auth/logout "$JAR")
[ "$CODE" = "204" ] || fail "로그아웃 HTTP $CODE (기대: 204)"
ok "로그아웃 요청 처리됨(HTTP 204)"

echo "=== 6) 로그아웃 후 재조회 (쿠키가 이미 지워져 인증 없는 요청이 되는 것이 정상) ==="
CODE=$(get_status /api/auth/me "$JAR")
[ "$CODE" = "200" ] && assert_json_field authenticated false || fail "로그아웃 후 상태가 기대와 다릅니다(HTTP $CODE, authenticated=false 기대)"
ok "로그아웃 후 authenticated=false 확인"

echo "=== 6-1) 로그아웃 전 쿠키 값을 재사용해도 거부되는지 확인(서버 측 무효화 검증) ==="
if [ -f "$STALE_JAR" ]; then
  CODE=$(get_status /api/auth/me "$STALE_JAR")
  [ "$CODE" = "200" ] && assert_json_field authenticated false || fail "예전 세션 쿠키가 여전히 통합니다(HTTP $CODE) — 서버 측 무효화가 안 된 것으로 보입니다"
  ok "예전 세션 쿠키 재사용이 거부됨(authenticated=false)"
else
  echo "건너뜀: 4번 단계에서 세션 쿠키를 확보하지 못했습니다."
fi

echo "=== 7) 비밀번호 재설정 ==="
P="$(payload_file "email=$EMAILFILE")"
CODE=$(post_json_file /api/auth/forgot-password "$JAR" "$P"); rm -f "$P"
[ "$CODE" = "200" ] || fail "비밀번호 재설정 요청 HTTP $CODE (기대: 200)"
echo "[직접 확인] 재설정 코드를 같은 받은편지함에서 확인하세요."
RCODEFILE="$(new_secret_file)"; read_hidden_to_file "재설정 코드: " "$RCODEFILE"
NPWFILE="$(new_secret_file)"; read_hidden_to_file "새 비밀번호: " "$NPWFILE"
P="$(payload_file "email=$EMAILFILE" "code=$RCODEFILE" "newPassword=$NPWFILE")"
CODE=$(post_json_file /api/auth/confirm-forgot-password "$JAR" "$P"); rm -f "$P" "$RCODEFILE"
[ "$CODE" = "200" ] || fail "비밀번호 재설정 확인 HTTP $CODE (기대: 200)"
ok "비밀번호 재설정 완료"

echo "=== 8) 새 비밀번호로 재로그인 ==="
P="$(payload_file "email=$EMAILFILE" "password=$NPWFILE")"
CODE=$(post_json_file /api/auth/login "$JAR" "$P"); rm -f "$P"
[ "$CODE" = "200" ] || fail "새 비밀번호 로그인 HTTP $CODE (기대: 200)"
ok "새 비밀번호로 로그인 성공"

echo "=== 9) 두 번째 세션 로그인 후 logout-all ==="
P="$(payload_file "email=$EMAILFILE" "password=$NPWFILE")"; rm -f "$NPWFILE"
CODE=$(post_json_file /api/auth/login "$JAR2" "$P"); rm -f "$P"
[ "$CODE" = "200" ] || fail "두 번째 세션 로그인 HTTP $CODE (기대: 200)"
ok "두 번째 세션 로그인 성공"

# 실제 API 계약: /api/auth/logout-all 성공도 204(본문 없음).
CODE=$(post_empty /api/auth/logout-all "$JAR")
[ "$CODE" = "204" ] || fail "logout-all HTTP $CODE (기대: 204)"

CODE=$(get_status /api/auth/me "$JAR2")
[ "$CODE" = "200" ] && assert_json_field authenticated false || fail "logout-all 후에도 두 번째 세션이 살아 있습니다(HTTP $CODE, authenticated=false 기대)"
ok "logout-all이 다른 세션에도 즉시 적용됨"

echo "=== 인증 흐름 검증 통과(1~9단계) ==="

# ── 10) DB 정리(RevokeToken) 확인 — 인증 흐름과는 별도 결과로 취급한다 ──────
# set -e/pipefail 아래서도 psql 실패가 스크립트를 조용히 죽이지 않도록 각 시도를 개별적으로
# set +e/-e로 감싼다. 확인할 수 없는 모든 경우(psql 미설치·DATABASE_URL 없음·접속/쿼리 실패·
# 조회 대상 없음·시간 초과)를 "완료"가 아니라 "DB 정리 상태 미확인"으로만 표시한다 — 토큰 폐기를
# 성공으로 보고하지 않는다. 오류 원문은 접속정보(DSN)를 담고 있을 수 있어 그대로 출력하지 않는다.
echo "=== 10) refresh token 정리(RevokeToken) 완료 확인 [DB 확인 — 인증 흐름과 별도 결과] ==="
DB_CLEANUP_RESULT="미확인"
DB_CLEANUP_DETAIL="시도하지 않음"
SESSION_ID="$(awk -F'\t' '$6=="dd_session"{print $7}' "$JAR2" | tail -1)"

if [ -z "$SESSION_ID" ]; then
  DB_CLEANUP_DETAIL="세션 id를 찾지 못했습니다(9번 로그인 결과 확인 필요)"
elif ! command -v psql >/dev/null 2>&1; then
  DB_CLEANUP_DETAIL="psql이 설치돼 있지 않습니다"
elif [ -z "$DATABASE_URL" ]; then
  DB_CLEANUP_DETAIL=".env에서 DATABASE_URL을 확인하지 못했습니다"
else
  echo "${POLL_INTERVAL_SECONDS}초 간격으로 최대 ${POLL_ATTEMPTS}회 확인합니다(접속정보·세션 id는 출력하지 않음)."
  QFILE="$WORKDIR/cleanup-query.sql"
  printf "SELECT cognito_cleanup_pending FROM sessions WHERE id = '%s';\n" "$SESSION_ID" > "$QFILE"
  chmod 600 "$QFILE"
  unset SESSION_ID
  for i in $(seq 1 "$POLL_ATTEMPTS"); do
    set +e
    RAW_OUT="$(PGDATABASE="$DATABASE_URL" psql -X -A -t -f "$QFILE" 2>"$WORKDIR/psql.err")"
    RC=$?
    set -e
    if [ $RC -ne 0 ]; then
      echo "  [$i] DB 조회 실행 실패(접속정보가 담길 수 있어 원문은 출력하지 않음)"
      DB_CLEANUP_DETAIL="DB 접속 또는 쿼리 실행에 실패했습니다"
      break
    fi
    PENDING="$(printf '%s' "$RAW_OUT" | tr -d '[:space:]')"
    if [ -z "$PENDING" ]; then
      echo "  [$i] 조회 결과 없음(해당 세션 행을 찾지 못함)"
      DB_CLEANUP_DETAIL="조회 대상 세션 행이 없습니다"
      break
    fi
    echo "  [$i] cognito_cleanup_pending=$PENDING"
    if [ "$PENDING" = "f" ]; then
      DB_CLEANUP_RESULT="완료"
      DB_CLEANUP_DETAIL=""
      break
    fi
    DB_CLEANUP_DETAIL="시간 초과(${POLL_ATTEMPTS}회 확인, 서버가 계속 재시도 중일 수 있음)"
    if [ "$i" -lt "$POLL_ATTEMPTS" ]; then sleep "$POLL_INTERVAL_SECONDS"; fi
  done
  rm -f "$QFILE" "$WORKDIR/psql.err"
fi

if [ "$DB_CLEANUP_RESULT" = "완료" ]; then
  ok "refresh token 정리 완료 확인됨"
else
  echo "DB 정리 상태 미확인: $DB_CLEANUP_DETAIL — 토큰 폐기를 완료로 보고하지 않습니다."
fi

echo "=== 결과 요약 ==="
echo "인증 흐름 검증(1~9단계): 통과"
echo "DB 정리 상태 확인(10단계): $DB_CLEANUP_RESULT"
