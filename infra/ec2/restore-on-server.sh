#!/bin/bash
# EC2 서버 "안에서" 실행한다(로컬 머신 아님) — backup-restore-drill.sh가 scp로 덤프 파일을 옮긴 뒤
# ssh로 이 스크립트를 원격 실행한다. 운영 DB를 절대 덮어쓰지 않는, 격리된 복원 훈련 전용이다.
#
# 핵심 규칙:
# - 복원 대상 DB 이름은 반드시 "_restore_drill"로 끝나야 한다(apps/api의 테스트 DB가 "_test"로
#   끝나야만 하는 규칙과 같은 발상) — 운영 DB 이름(deardarling_dev 등)으로는 절대 복원하지 않는다.
# - DB 생성/삭제는 OS의 postgres 슈퍼유저(sudo -u postgres)로만 한다 — 앱 사용자(deardarling)는
#   CREATE DATABASE/DROP DATABASE 권한이 없고, 이 스크립트도 그 권한을 주지 않는다.
# - 실제 행 데이터·개인정보는 어떤 경우에도 출력하지 않는다 — 검증은 테이블별 row count(숫자)만
#   비교한다.
# - 같은 서버의 디스크를 공유하므로, 복원 전 여유 공간을 확인하고 부족하면 중단한다.
# - row count 매니페스트는 "있으면 좋은 것"이 아니라 복원 검증의 필수 조건이다 — 파일이 없거나
#   손상됐으면 pg_restore 성공 여부와 무관하게 "복원 검증 미완료"로 실패 종료한다(예전엔 매니페스트가
#   없으면 "미확인"이라고만 로그를 남기고 성공/exit 0으로 끝났는데, 그러면 실제로 아무것도
#   검증하지 못한 실행이 성공으로 보고되는 문제가 있었다). 이 검사는 복원용 DB를 만들기 "전에"
#   먼저 한다 — 어차피 검증할 수 없다면 DB 생성·pg_restore까지 갈 필요가 없다.
#
# 사용법: sudo ./restore-on-server.sh <dump.gz 경로> [restore-db-이름(기본: deardarling_restore_drill)]

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "사용법: restore-on-server.sh <dump.gz 경로> [restore-db-이름]" >&2
  exit 1
fi
DUMP_GZ="$1"
RESTORE_DB="${2:-deardarling_restore_drill}"
PG_OS_USER="${PG_OS_USER:-postgres}"
PROD_DB_DENYLIST=("deardarling_dev" "deardarling_test")
MIN_FREE_MB="${MIN_FREE_MB:-1024}"

log() { echo "[restore-on-server] $*"; }
die() { echo "[restore-on-server] 오류: $*" >&2; exit 1; }

case "$RESTORE_DB" in
  *_restore_drill) : ;;
  *) die "복원 대상 DB 이름(\"$RESTORE_DB\")은 반드시 \"_restore_drill\"로 끝나야 합니다 — 운영 DB를" \
         " 실수로 덮어쓰는 사고를 막기 위한 규칙입니다." ;;
esac
for bad in "${PROD_DB_DENYLIST[@]}"; do
  [ "$RESTORE_DB" != "$bad" ] || die "복원 대상이 운영/테스트 DB 이름(\"$bad\")과 같습니다 — 중단합니다."
done

[ -f "$DUMP_GZ" ] || die "덤프 파일을 찾을 수 없습니다: $DUMP_GZ"

log "[1/5] 여유 디스크 공간 확인 중 (PostgreSQL 데이터가 있는 파일시스템 기준, 최소 ${MIN_FREE_MB}MB 필요)..."
PGDATA_DIR="$(sudo -u "$PG_OS_USER" psql -tA -c 'SHOW data_directory;' 2>/dev/null || true)"
CHECK_PATH="${PGDATA_DIR:-/}"
FREE_MB="$(df -Pm "$CHECK_PATH" | awk 'NR==2{print $4}')"
[ -n "$FREE_MB" ] || die "여유 공간을 확인하지 못했습니다."
if [ "$FREE_MB" -lt "$MIN_FREE_MB" ]; then
  die "여유 공간이 부족합니다(${FREE_MB}MB < ${MIN_FREE_MB}MB) — 같은 서버의 디스크를 운영 DB와" \
      " 공유하므로, 여유가 부족한 채로 복원을 진행하면 운영 DB에도 영향을 줄 수 있어 중단합니다."
fi
log "  여유 공간 ${FREE_MB}MB 확인됨"

log "[2/5] 복원 검증에 필요한 매니페스트 확인 중 (DB 생성 전에 먼저 확인 — 검증 불가능하면 여기서 중단)..."
MANIFEST="${DUMP_GZ%.dump.gz}.manifest.json"
if [ ! -f "$MANIFEST" ]; then
  die "매니페스트 파일이 없습니다($MANIFEST) — row count 검증 없이는 복원 성공을 보고하지 않습니다." \
      " 복원 검증 미완료: 백업 스크립트가 .manifest.json을 덤프와 함께 남겼는지 확인하세요."
fi
# 파싱·구조 검증을 먼저 "따로" 수행하고, 그 명령의 종료코드를 직접 확인한다 — 이전 버전은
# 이 파싱을 `while ... done < <(node -e ...)` 프로세스 치환 안에서 했는데, 그 안에서 node가
# 실패해도(손상된 JSON 등) 프로세스 치환의 종료코드는 바깥의 while/if에 전달되지 않아 아무
# 줄도 못 읽은 채 "불일치 0건"으로 조용히 "성공"이 돼버리는 문제가 있었다. AL2023 기본 이미지엔
# Node.js가 없고 python3은 기본 포함(dnf 자체가 의존)이라 python3로 검증한다.
MANIFEST_TSV="$(mktemp)"
MANIFEST_ERR="$(mktemp)"
if python3 -c "
import json, re, sys
try:
    with open('$MANIFEST', encoding='utf-8') as f:
        raw = f.read()
except OSError as e:
    sys.stderr.write('매니페스트 파일을 읽을 수 없음: ' + str(e) + '\n'); sys.exit(1)
try:
    m = json.loads(raw)
except json.JSONDecodeError as e:
    sys.stderr.write('매니페스트가 올바른 JSON이 아님: ' + str(e) + '\n'); sys.exit(1)
if not isinstance(m, dict):
    sys.stderr.write('매니페스트가 객체(JSON object) 형식이 아님\n'); sys.exit(1)
entries = list(m.items())
if not entries:
    sys.stderr.write('매니페스트에 항목이 하나도 없음\n'); sys.exit(1)
for k, v in entries:
    # fullmatch는 시작/끝 앵커가 필요 없어(자체적으로 전체 문자열에 매칭) 이 정규식 안에 셸이
    # 변수 치환으로 오해할 수 있는 '\$' 문자를 넣지 않아도 된다.
    if not re.fullmatch(r'[^.]+\.[^.]+', k):
        sys.stderr.write('키 형식이 schema.table이 아님: ' + k + '\n'); sys.exit(1)
    if not isinstance(v, int) or isinstance(v, bool) or v < 0:
        sys.stderr.write('값이 올바른 음이 아닌 정수가 아님: ' + k + '\n'); sys.exit(1)
for k, v in entries:
    print(k + '\t' + str(v))
" > "$MANIFEST_TSV" 2>"$MANIFEST_ERR"; then
  log "  매니페스트 확인됨(형식 정상)"
else
  log "  매니페스트 파싱/구조 검증 실패(원인, 개인정보 아님):"
  sed 's/^/    /' "$MANIFEST_ERR"
  rm -f "$MANIFEST_TSV" "$MANIFEST_ERR"
  die "매니페스트가 손상됐거나 형식이 올바르지 않습니다 — 복원 검증 미완료로 처리하고 DB를 만들지 않습니다."
fi

log "[3/5] 복원용 임시 DB \"$RESTORE_DB\" 생성 중 (postgres 슈퍼유저로만 실행)..."
if sudo -u "$PG_OS_USER" psql -tA -c "SELECT 1 FROM pg_database WHERE datname = '$RESTORE_DB'" | grep -q 1; then
  rm -f "$MANIFEST_TSV" "$MANIFEST_ERR"
  die "\"$RESTORE_DB\"가 이미 존재합니다 — 이전 훈련이 정리되지 않았을 수 있으니 먼저 직접" \
      " 확인하고 지운 뒤 재실행하세요(이 스크립트가 기존 DB를 임의로 덮어쓰지 않습니다)."
fi
sudo -u "$PG_OS_USER" createdb "$RESTORE_DB"

cleanup() {
  local rc=$?
  log "[정리] \"$RESTORE_DB\" 삭제 및 임시 파일 제거..."
  sudo -u "$PG_OS_USER" dropdb --if-exists "$RESTORE_DB" || true
  rm -f "$DUMP_GZ" "${DUMP_GZ%.gz}" "$MANIFEST_TSV" "$MANIFEST_ERR"
  exit $rc  # 정리 명령이 원래 실패 종료코드를 0으로 덮지 않게
}
trap cleanup EXIT

log "[4/5] 복원 실행 중 (gunzip | pg_restore, custom 포맷)..."
set +e
gunzip -c "$DUMP_GZ" | sudo -u "$PG_OS_USER" pg_restore -d "$RESTORE_DB" --no-owner --no-privileges 2> "/tmp/restore-drill-$$.err"
RESTORE_RC=$?
set -e
if [ $RESTORE_RC -ne 0 ]; then
  log "  pg_restore 오류(요약, 개인정보 없는 스키마/오류 메시지만):"
  grep -v -E "COPY|INSERT" "/tmp/restore-drill-$$.err" | head -20 || true
  rm -f "/tmp/restore-drill-$$.err"
  die "pg_restore가 오류로 끝났습니다(종료코드 $RESTORE_RC) — 성공으로 보고하지 않습니다."
fi
rm -f "/tmp/restore-drill-$$.err"
log "  pg_restore 종료코드 0"

log "[5/5] 결과 검증 중 (테이블별 row count만 비교 — 실제 데이터는 출력하지 않음)..."
MISMATCH=0
while IFS=$'\t' read -r key expected; do
  [ -z "$key" ] && continue
  schema="${key%%.*}"
  tbl="${key#*.}"
  actual="$(sudo -u "$PG_OS_USER" psql -tA -d "$RESTORE_DB" -c "SELECT count(*) FROM \"$schema\".\"$tbl\";" 2>/dev/null || echo "ERROR")"
  if [ "$actual" = "$expected" ]; then
    log "  [OK] $key: ${actual}행(기대치 일치)"
  else
    log "  [불일치] $key: 실제 ${actual:-없음}행 / 기대 ${expected}행"
    MISMATCH=1
  fi
done < "$MANIFEST_TSV"   # 이미 검증을 통과한 일반 파일을 읽는 것뿐이라 프로세스 치환이 아니어도 안전
[ "$MISMATCH" -eq 0 ] || die "일부 테이블의 row count가 백업 시점 매니페스트와 다릅니다 — 성공으로 보고하지 않습니다."

log "성공 — pg_restore 종료코드 0, row count 일치(검증됨)."
log "정리(임시 DB 삭제·파일 제거)는 스크립트 종료 시 자동 실행됩니다."
