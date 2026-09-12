#!/bin/bash
# verify-auth-flow.sh를 실제 서버·DB 없이 검증한다(가짜 curl/psql + 임시 파일만 사용).
set -uo pipefail  # -e는 안 씀 — 각 케이스의 실패 여부를 직접 판정해야 해서
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COGNITO_DIR="$(cd "$SELF_DIR/.." && pwd)"
PASS=0; FAIL=0

setup_work() {  # $1 = "with_psql" | "no_psql"
  local WORK; WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo/apps/api" "$WORK/bin" "$WORK/httpstate" "$WORK/repo/infra/cognito"
  cp "$COGNITO_DIR/verify-auth-flow.sh" "$COGNITO_DIR/env-lib.mjs" "$WORK/repo/infra/cognito/"
  cp "$SELF_DIR/fake-curl" "$WORK/bin/curl"; chmod +x "$WORK/bin/curl"
  if [ "$1" = "with_psql" ]; then
    cp "$SELF_DIR/fake-psql" "$WORK/bin/psql"; chmod +x "$WORK/bin/psql"
  fi
  cat > "$WORK/repo/apps/api/.env" <<'EOF'
DATABASE_URL=postgres://fake:fake@127.0.0.1:5432/deardarling_dev
ALLOWED_ORIGIN=http://127.0.0.1:3000
LOCAL_TEST_AUTH=false
EOF
  printf '%s' "$WORK"
}

# 7줄: 이메일, 가입비번, 인증코드, 로그인비번, 재설정코드, 새비번, 두번째세션비번
STDIN_LINES=$'tester@example.com\npw1\ncode1\npw1\nresetcode1\nnewpw1\nnewpw1\n'

run_once() {  # $1=WORK $2=FAKE_HTTP_MODE $3=FAKE_PSQL_MODE $4=poll_attempts $5=poll_interval
  local WORK="$1"
  PATH="$WORK/bin:/usr/bin:/bin:/usr/local/bin" \
    FAKE_HTTP_MODE="$2" FAKE_HTTP_STATE_DIR="$WORK/httpstate" \
    FAKE_PSQL_MODE="$3" CLEANUP_POLL_ATTEMPTS="$4" CLEANUP_POLL_INTERVAL_SECONDS="$5" \
    bash "$WORK/repo/infra/cognito/verify-auth-flow.sh" --repo-root "$WORK/repo" \
    <<<"$STDIN_LINES" > "$WORK/run.log" 2>&1
}

report() {  # $1=이름 $2=WORK $3=0/1
  if [ "$3" -eq 1 ]; then echo "PASS  $1"; PASS=$((PASS + 1));
  else echo "FAIL  $1"; FAIL=$((FAIL + 1)); echo "  --- run.log ---"; sed 's/^/  /' "$2/run.log" 2>/dev/null
  fi
  rm -rf "$2"
}

# 1) 정상 흐름: 인증 9단계 통과 + DB 정리 완료
W="$(setup_work with_psql)"; run_once "$W" happy normal 3 0; RC=$?
ok=1
[ "$RC" -eq 0 ] || ok=0
grep -q "인증 흐름 검증(1~9단계): 통과" "$W/run.log" || ok=0
grep -q "DB 정리 상태 확인(10단계): 완료" "$W/run.log" || ok=0
report "happy-path-with-db-cleanup-confirmed" "$W" "$ok"

# 2) logout 오류 응답 -> 5단계에서 중단, 7단계(비밀번호 재설정) 도달 안 함
W="$(setup_work with_psql)"; run_once "$W" logout_error normal 3 0; RC=$?
ok=1
[ "$RC" -eq 0 ] && ok=0
grep -q "실패: 로그아웃 HTTP 500" "$W/run.log" || ok=0
grep -q "비밀번호 재설정 완료" "$W/run.log" && ok=0
report "logout-500-must-abort-before-later-steps" "$W" "$ok"

# 3) logout 204 정상 -> 다음 단계(6번, 로그아웃 후 재조회)까지 진행
W="$(setup_work with_psql)"; run_once "$W" happy normal 3 0; RC=$?
ok=1
grep -q "로그아웃 요청 처리됨(HTTP 204)" "$W/run.log" || ok=0
grep -q "로그아웃 후 authenticated=false 확인" "$W/run.log" || ok=0
report "logout-204-proceeds-to-next-step" "$W" "$ok"

# 4) logout-all 오류 응답 -> 9단계에서 중단(직전 "두 번째 세션 로그인 성공"은 찍혀 있어야 함)
W="$(setup_work with_psql)"; run_once "$W" logout_all_error normal 3 0; RC=$?
ok=1
[ "$RC" -eq 0 ] && ok=0
grep -q "두 번째 세션 로그인 성공" "$W/run.log" || ok=0
grep -q "logout-all이 다른 세션에도 즉시 적용됨" "$W/run.log" && ok=0
report "logout-all-500-must-abort" "$W" "$ok"

# 5) 기존 쿠키 재사용 거부 검증이 실제로 통과하는지(정상 흐름에 포함돼 있으므로 happy에서 확인)
W="$(setup_work with_psql)"; run_once "$W" happy normal 3 0; RC=$?
ok=1
grep -q "예전 세션 쿠키 재사용이 거부됨" "$W/run.log" || ok=0
report "stale-cookie-reuse-rejected" "$W" "$ok"

# 6) 두 번째 세션 전체 로그아웃 적용 검증(정상 흐름에 포함)
W="$(setup_work with_psql)"; run_once "$W" happy normal 3 0; RC=$?
ok=1
grep -q "logout-all이 다른 세션에도 즉시 적용됨" "$W/run.log" || ok=0
report "second-session-blocked-by-logout-all" "$W" "$ok"

# 7) psql 미설치 -> 전체는 성공(exit 0), DB는 미확인
W="$(setup_work no_psql)"; run_once "$W" happy normal 3 0; RC=$?
ok=1
[ "$RC" -eq 0 ] || ok=0
grep -q "DB 정리 상태 미확인: psql이 설치돼 있지 않습니다" "$W/run.log" || ok=0
grep -q "DB 정리 상태 확인(10단계): 미확인" "$W/run.log" || ok=0
report "db-check-psql-missing-is-unconfirmed-not-failure" "$W" "$ok"

# 8) DATABASE_URL 누락 -> 미확인(psql 존재 여부와 무관)
W="$(setup_work with_psql)"
printf 'ALLOWED_ORIGIN=http://127.0.0.1:3000\nLOCAL_TEST_AUTH=false\n' > "$W/repo/apps/api/.env"
run_once "$W" happy normal 3 0; RC=$?
ok=1
[ "$RC" -eq 0 ] || ok=0
grep -q "DATABASE_URL을 확인하지 못했습니다" "$W/run.log" || ok=0
report "db-check-database-url-missing-is-unconfirmed" "$W" "$ok"

# 9) DB 쿼리 실행 자체 실패 -> 미확인 + 오류 원문(DSN 마커)이 출력에 없어야 함
W="$(setup_work with_psql)"; run_once "$W" happy exec_fail 3 0; RC=$?
ok=1
[ "$RC" -eq 0 ] || ok=0
grep -q "DB 접속 또는 쿼리 실행에 실패했습니다" "$W/run.log" || ok=0
grep -q "FAKE_DSN_SECRET_MARKER" "$W/run.log" && ok=0
report "db-check-exec-failure-hides-raw-error" "$W" "$ok"

# 10) 조회 결과 없음(행 없음) -> 미확인
W="$(setup_work with_psql)"; run_once "$W" happy empty 3 0; RC=$?
ok=1
[ "$RC" -eq 0 ] || ok=0
grep -q "조회 대상 세션 행이 없습니다" "$W/run.log" || ok=0
report "db-check-empty-result-is-unconfirmed" "$W" "$ok"

# 11) 계속 정리 대기 중(pending) -> 시간 초과로 미확인(전체는 exit 0)
W="$(setup_work with_psql)"; run_once "$W" happy pending 2 0; RC=$?
ok=1
[ "$RC" -eq 0 ] || ok=0
grep -q "시간 초과" "$W/run.log" || ok=0
grep -q "DB 정리 상태 확인(10단계): 미확인" "$W/run.log" || ok=0
report "db-check-timeout-is-unconfirmed-not-success" "$W" "$ok"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
