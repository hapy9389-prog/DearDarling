#!/bin/bash
# restore-on-server.sh를 실제 PostgreSQL 없이(가짜 psql/sudo/createdb/dropdb/pg_restore) 검증한다.
# 이번 회귀의 핵심: 매니페스트가 손상됐거나 형식이 잘못됐을 때 "row count 일치"로 조용히
# 넘어가지 않고 반드시 실패로 끝나는지 확인한다.
set -uo pipefail  # -e는 안 씀

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EC2_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0

check() {
  local desc="$1" ok="$2"
  if [ "$ok" = "yes" ]; then PASS=$((PASS+1)); echo "  [PASS] $desc";
  else FAIL=$((FAIL+1)); echo "  [FAIL] $desc"; echo "$CASE_OUT" | sed 's/^/         /'; fi
}

setup_fakebin() {
  local bin="$1" fixed_count="$2"  # fixed_count: count(*) 쿼리에 항상 이 값으로 응답
  cat > "$bin/sudo" <<'EOF'
#!/bin/bash
# "-u 사용자" 부분만 건너뛰고 나머지 명령을 그대로 실행한다(진짜 sudo 불필요).
if [ "$1" = "-u" ]; then shift 2; fi
exec "$@"
EOF
  chmod +x "$bin/sudo"

  cat > "$bin/psql" <<EOF
#!/bin/bash
QUERY=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = "-c" ]; then QUERY="\$a"; fi
  prev="\$a"
done
case "\$QUERY" in
  *data_directory*) echo "" ;;
  *"FROM pg_database"*) : ;;  # 아무 것도 출력 안 함 -> DB 없음 -> createdb 경로
  *"count(*)"*) echo "$fixed_count" ;;
  *) echo "" ;;
esac
EOF
  chmod +x "$bin/psql"

  cat > "$bin/createdb" <<'EOF'
#!/bin/bash
exit 0
EOF
  cat > "$bin/dropdb" <<'EOF'
#!/bin/bash
exit 0
EOF
  cat > "$bin/pg_restore" <<'EOF'
#!/bin/bash
cat > /dev/null   # stdin 소비만 하고 성공
exit 0
EOF
  chmod +x "$bin/createdb" "$bin/dropdb" "$bin/pg_restore"
}

run_restore_case() {
  local manifest_content="$1" fixed_count="${2:-3}"
  local bin work
  bin="$(mktemp -d)"
  work="$(mktemp -d)"
  setup_fakebin "$bin" "$fixed_count"

  local dumpgz="$work/2026-09-12.dump.gz"
  printf 'fake dump body' | gzip > "$dumpgz"
  local manifest="$work/2026-09-12.manifest.json"
  if [ -n "$manifest_content" ]; then
    printf '%s' "$manifest_content" > "$manifest"
  fi

  CASE_OUT="$(PATH="$bin:$PATH" MIN_FREE_MB=1 PG_OS_USER="$(id -un)" \
    bash "$EC2_DIR/restore-on-server.sh" "$dumpgz" "deardarling_test_restore_drill" 2>&1)"
  CASE_RC=$?
  rm -rf "$bin" "$work"
}

echo "1) 정상적인 매니페스트 + 실제 count(*) 일치 → 성공, row count 일치로 보고해야 한다"
run_restore_case '{"public.provision_test": 3}' 3
[ "$CASE_RC" -eq 0 ] && [[ "$CASE_OUT" == *"row count 일치(검증됨)"* ]] && ok=yes || ok=no
check "정상 종료 + 일치 보고" "$ok"

echo "2) 손상된 JSON(문법 오류) 매니페스트 → 성공 메시지 없이 실패 종료해야 한다(핵심 회귀)"
run_restore_case '{bad json' 3
[ "$CASE_RC" -ne 0 ] && ok=yes || ok=no
check "0이 아닌 종료코드" "$ok"
[[ "$CASE_OUT" != *"row count 일치"* ]] && ok=yes || ok=no
check "\"row count 일치\" 성공 메시지가 절대 나오지 않음" "$ok"
[[ "$CASE_OUT" == *"손상"* ]] && ok=yes || ok=no
check "손상 원인 메시지 출력" "$ok"
[[ "$CASE_OUT" != *"복원용 임시 DB"* ]] && ok=yes || ok=no
check "DB 생성 전에 매니페스트부터 확인해 DB를 만들지 않음" "$ok"

echo "3) 값이 정수가 아닌 매니페스트(문자열 값) → 실패 종료해야 한다"
run_restore_case '{"public.provision_test": "three"}' 3
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" != *"row count 일치"* ]] && ok=yes || ok=no
check "잘못된 값 타입 감지 + 실패" "$ok"
[[ "$CASE_OUT" != *"복원용 임시 DB"* ]] && ok=yes || ok=no
check "DB 생성 전에 매니페스트부터 확인해 DB를 만들지 않음" "$ok"

echo "4) 빈 객체({}) 매니페스트 → 항목이 없다는 이유로 실패해야 한다(성공으로 넘어가지 않음)"
run_restore_case '{}' 3
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" != *"row count 일치"* ]] && ok=yes || ok=no
check "빈 매니페스트 거부" "$ok"

echo "5) 키 형식이 schema.table이 아닌 매니페스트 → 실패해야 한다"
run_restore_case '{"provision_test": 3}' 3
[ "$CASE_RC" -ne 0 ] && ok=yes || ok=no
check "schema 없는 키 거부" "$ok"

echo "6) 매니페스트 파일 자체가 없으면 — '미확인'이라며 성공(exit 0)으로 끝나면 안 되고, 복원 검증 미완료로 실패 종료해야 한다(핵심 회귀)"
run_restore_case "" 3
[ "$CASE_RC" -ne 0 ] && ok=yes || ok=no
check "0이 아닌 종료코드(더 이상 조용히 성공하지 않음)" "$ok"
[[ "$CASE_OUT" != *"row count 일치"* ]] && ok=yes || ok=no
check "\"row count 일치\" 성공 메시지가 나오지 않음" "$ok"
[[ "$CASE_OUT" == *"복원 검증 미완료"* ]] && ok=yes || ok=no
check "복원 검증 미완료 사유를 명확히 표시함" "$ok"
[[ "$CASE_OUT" != *"복원용 임시 DB"* ]] && ok=yes || ok=no
check "매니페스트가 없으면 복원용 DB조차 만들지 않음(DB 생성 전에 먼저 확인)" "$ok"

echo "7) row count가 실제와 다르면(불일치) 실패해야 한다"
run_restore_case '{"public.provision_test": 999}' 3
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"불일치"* ]] && ok=yes || ok=no
check "불일치 감지 + 실패" "$ok"

echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
