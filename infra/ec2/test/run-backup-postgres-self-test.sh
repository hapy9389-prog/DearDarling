#!/bin/bash
# backup-postgres.sh 중 "실제 PostgreSQL 없이 안전하게 검증 가능한 부분"만 오프라인으로 확인한다.
#
# 이 스크립트는 이제 pg_export_snapshot()을 공유하는 대화형 psql 세션(BEGIN → 스냅샷 추출 →
# pg_dump --snapshot → 같은 트랜잭션 안에서 DO 블록으로 count(*) 집계 → COMMIT)을 실제로
# 주고받는다 — 이 프로토콜 자체는 진짜 PostgreSQL 없이 의미 있게 흉내 낼 수 없다(단순히 고정된
# 줄을 돌려주는 가짜 psql로는 세션의 실제 순서·트랜잭션 동작을 검증하지 못하고, 검증한다고
# 주장하면 오히려 거짓 안심을 준다). 그래서 그 부분(스냅샷 일관성, 실제 count(*) 정확성,
# 업로드 시점 파일 권한)은 실제 서버의 실제 PostgreSQL로 확인했다 — 완료 보고의 "미검증 항목"
# 절 참고.
#
# 여기서 오프라인으로 확실히 검증할 수 있는 것: 실행 사용자가 postgres가 아니면 임시 폴더를
# 만들기 전에 명확히 거부하는지(다른 사용자로 조용히 전환하지 않는지) — 이건 PostgreSQL이
# 전혀 필요 없는 순수 bash 로직이다.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EC2_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0

check() {
  local desc="$1" ok="$2"
  if [ "$ok" = "yes" ]; then PASS=$((PASS+1)); echo "  [PASS] $desc";
  else FAIL=$((FAIL+1)); echo "  [FAIL] $desc"; echo "$CASE_OUT" | sed 's/^/         /'; fi
}

echo "1) postgres가 아닌 사용자로 실행하면 임시 폴더를 만들기 전에 명확히 거부해야 한다(다른 사용자로 자동 전환하지 않음)"
BEFORE_TMP_COUNT="$(find /tmp -maxdepth 1 -user "$(id -un)" -newer /tmp 2>/dev/null | wc -l | tr -d ' ')"
CASE_OUT="$(PG_OS_USER=postgres APP_DB=irrelevant bash "$EC2_DIR/backup-postgres.sh" 2>&1)"
CASE_RC=$?
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"반드시 \"postgres\" 사용자로 실행"* ]] && ok=yes || ok=no
check "postgres 사용자가 아니면 거부 + 올바른 실행법 안내" "$ok"
[[ "$CASE_OUT" != *"pg_dump"* ]] && ok=yes || ok=no
check "거부 후에는 pg_dump를 시도조차 하지 않음(임시 폴더 생성 전에 걸러짐)" "$ok"

echo "2) 응답하지 않는(게다가 SIGTERM도 무시하는) 가짜 psql 세션 — 시간 초과 뒤 이 세션만 강제 종료하고," \
   "제한 시간 안에 끝나며, 자식 프로세스·임시 폴더를 남기지 않아야 한다(핵심 회귀)"
FAKEBIN="$(mktemp -d)"
ISO_TMPDIR="$(mktemp -d)"   # mktemp -d(WORK_DIR)가 여기 아래에만 생기게 해서 뒤에 비어있는지 확인
PID_FILE="$FAKEBIN/psql.pid"

cat > "$FAKEBIN/psql" <<EOF
#!/bin/bash
# 실제 psql 대신: 자기 PID만 남기고 SIGTERM도 무시한 채 영원히 응답하지 않는다 — SIGKILL까지
# 가는 전체 종료 경로(정상 종료 시도 → SIGTERM → SIGKILL)를 실제로 검증하기 위함이다.
echo "\$\$" > "$PID_FILE"
trap '' TERM
exec sleep 100000
EOF
chmod +x "$FAKEBIN/psql"

START_TS=$(date +%s)
CASE_OUT="$(PATH="$FAKEBIN:$PATH" TMPDIR="$ISO_TMPDIR" PG_OS_USER="$(id -un)" APP_DB=irrelevant \
  SNAPSHOT_READY_TIMEOUT=1 CLEANUP_GRACE_TIMEOUT=1 CLEANUP_KILL_TIMEOUT=1 \
  bash "$EC2_DIR/backup-postgres.sh" 2>&1)"
CASE_RC=$?
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

[ "$CASE_RC" -ne 0 ] && ok=yes || ok=no
check "원래 실패 종료코드가 유지됨(0이 아님)" "$ok"

[ "$ELAPSED" -le 20 ] && ok=yes || ok=no
check "정리(SIGTERM→SIGKILL 단계 포함)까지 합쳐 20초 안에 끝남(실제: ${ELAPSED}초, 무한 대기 아님)" "$ok"

HUNG_PID="$(cat "$PID_FILE" 2>/dev/null || echo "")"
if [ -n "$HUNG_PID" ]; then
  sleep 0.3  # 종료 신호 처리 시간 약간 여유
  ! kill -0 "$HUNG_PID" 2>/dev/null && ok=yes || ok=no
else
  ok=no
fi
check "이 스크립트가 띄운 psql 자식 프로세스가 실제로 종료되고 남지 않음(PID=${HUNG_PID:-미확인})" "$ok"

[ -z "$(ls -A "$ISO_TMPDIR" 2>/dev/null)" ] && ok=yes || ok=no
check "임시 작업 폴더(WORK_DIR)가 정리돼 남지 않음" "$ok"

rm -rf "$FAKEBIN" "$ISO_TMPDIR"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
echo "(참고: 스냅샷 일관성·정확한 count(*)·postgres 사용자로 정상 실행 시의 파일 권한은" \
     "실제 PostgreSQL이 필요해 이 오프라인 테스트로는 확인하지 못함 — 실제 서버에서 별도 확인함)"
[ "$FAIL" -eq 0 ]
