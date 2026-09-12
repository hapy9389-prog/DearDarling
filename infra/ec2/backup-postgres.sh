#!/bin/bash
# EC2 서버 "안에서" systemd 서비스(User=postgres로 실행, deardarling-pg-backup.service 참고)로
# 매일 호출된다(로컬 머신 아님). pg_dump(custom 포맷) → 덤프와 같은 스냅샷 시점의 정확한
# 테이블별 row count 매니페스트 생성 → gzip → S3 업로드(인스턴스 역할 자격증명, 이 스크립트
# 안에 어떤 AWS 키도 두지 않는다 — EC2 인스턴스 프로파일이 자동으로 자격증명을 제공한다).
#
# 실행 사용자 정책(둘 중 "명확히 거부" 방식을 택함 — 이유는 아래):
#   이 스크립트는 반드시 postgres 사용자로 실행해야 한다. root 등 다른 사용자로 실행하면
#   그 사용자 소유로 임시 폴더가 만들어지고 이후 postgres가 그 안에 쓰려다 권한 오류가 나는
#   문제가 있었다(이전 버전의 버그) — 이번엔 아예 임시 폴더를 만들기 "전에" 실행 사용자를
#   확인해 postgres가 아니면 명확한 안내와 함께 즉시 거부한다(스크립트 스스로 사용자를
#   전환/재실행하지 않음 — 어떤 권한으로 무엇을 하는지 항상 명시적으로 드러나게 하기 위함).
#   올바른 실행: systemd(User=postgres로 이미 설정됨) 또는 `sudo -u postgres ./backup-postgres.sh`.
#
# row count 검증 기준: pg_stat_user_tables.n_live_tup는 추정치(autovacuum/analyze가 갱신)라
# 정확한 count(*)의 근거로 쓰지 않는다. 그렇다고 pg_dump가 끝난 "뒤에" count(*)를 새로 실행하면
# 그 사이의 데이터 변경으로 실제 덤프 내용과 어긋날 수 있다. 그래서 pg_dump가 사용하는 것과
# 정확히 같은 스냅샷을 pg_export_snapshot()으로 내보내 pg_dump에 --snapshot으로 넘기고, count(*)도
# 같은 트랜잭션(같은 스냅샷) 안에서 실행해 "덤프와 같은 데이터 시점"을 보장한다. 테이블명은
# 스키마로 한정해(schema.table) 이름은 같고 스키마가 다른 테이블을 구분한다. 실제 행 데이터는
# 어디에도 출력하지 않는다(카운트 숫자만).

set -euo pipefail
umask 077

APP_DB="${APP_DB:-deardarling_dev}"
PG_OS_USER="${PG_OS_USER:-postgres}"
BUCKET_NAME="deardarling-dev-backups-539746929196-ap-northeast-2"
PREFIX="postgres/dev"
DATE="$(date -u +%Y-%m-%d)"
SNAPSHOT_READY_TIMEOUT="${SNAPSHOT_READY_TIMEOUT:-10}"   # 초, pg_export_snapshot 응답 대기
COUNTS_READY_TIMEOUT="${COUNTS_READY_TIMEOUT:-30}"       # 초, count(*) 집계 응답 대기

log() { echo "[backup-postgres] $*"; }
die() { echo "[backup-postgres] 오류: $*" >&2; exit 1; }

CURRENT_USER="$(id -un)"
if [ "$CURRENT_USER" != "$PG_OS_USER" ]; then
  cat >&2 <<EOF
[backup-postgres] 오류: 이 스크립트는 반드시 "$PG_OS_USER" 사용자로 실행해야 합니다(현재: $CURRENT_USER).
임시 폴더를 만들기 전에 거부합니다 — 다른 사용자로 자동 전환하지 않습니다.
올바른 실행 방법:
  - systemd: systemctl start deardarling-pg-backup.service (User=${PG_OS_USER}로 이미 설정됨)
  - 수동 테스트: sudo -u $PG_OS_USER $0
EOF
  exit 1
fi

WORK_DIR="$(mktemp -d)"
chmod 700 "$WORK_DIR"
trap 'rc=$?; rm -rf "$WORK_DIR"; exit $rc' EXIT  # 정리 명령이 원래 실패 종료코드를 0으로 덮지 않게

DUMP_FILE="$WORK_DIR/$DATE.dump"
MANIFEST_FILE="$WORK_DIR/$DATE.manifest.json"

CLEANUP_GRACE_TIMEOUT="${CLEANUP_GRACE_TIMEOUT:-5}"  # 초, \q로 정상 종료를 기다리는 시간
CLEANUP_KILL_TIMEOUT="${CLEANUP_KILL_TIMEOUT:-5}"    # 초, SIGTERM 뒤 SIGKILL까지 기다리는 시간

# 특정 PID를 제한 시간 안에 기다린다(외부 timeout(1) 명령에 의존하지 않음 — 로컬 macOS 등엔
# 기본으로 없을 수 있어서다). 0=그 안에 끝남, 1=시간 초과(아직 살아있음).
wait_pid_with_timeout() {
  local pid="$1" timeout="$2" waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.2
    waited=$((waited + 1))
    [ "$waited" -ge $((timeout * 5)) ] && return 1
  done
  return 0
}

# ── 스냅샷을 공유하는 psql 세션을 하나 열어 둔다 (pg_dump와 count(*)가 같은 데이터 시점을 보게) ──
SESSION_FIFO="$WORK_DIR/session.fifo"
SESSION_OUT="$WORK_DIR/session.out"
mkfifo "$SESSION_FIFO"
: > "$SESSION_OUT"
exec 3<>"$SESSION_FIFO"   # 읽기+쓰기로 열어 두면 중간에 쓰는 쪽이 없어도 EOF가 나지 않는다
psql -X -qtA -d "$APP_DB" <&3 >"$SESSION_OUT" 2>&1 &
SESSION_PID=$!
SESSION_STOPPED="no"

# 이 스크립트가 띄운 psql 세션(SESSION_PID) "하나만" 종료한다 — 다른 DB 세션이나 PostgreSQL
# 서비스 전체는 절대 건드리지 않는다. 시간 초과(예: wait_for_marker의 die)로 여기 들어와도
# 무한정 기다리지 않도록 정리 자체에 제한 시간을 둔다: 정상 종료(\q) 시도 → 안 되면 이 세션에만
# SIGTERM → 그래도 안 되면 이 세션에만 SIGKILL. 이미 정리됐으면(정상 COMMIT 후 등) 아무 것도
# 하지 않고 즉시 반환한다(멱등 — 스크립트 여러 지점에서 안전하게 다시 불러도 됨).
stop_session() {
  [ "$SESSION_STOPPED" = "yes" ] && return 0
  SESSION_STOPPED="yes"
  if kill -0 "$SESSION_PID" 2>/dev/null; then
    echo '\q' >&3 2>/dev/null || true
    exec 3>&- 2>/dev/null || true
    if ! wait_pid_with_timeout "$SESSION_PID" "$CLEANUP_GRACE_TIMEOUT"; then
      log "psql 세션(PID=$SESSION_PID)이 ${CLEANUP_GRACE_TIMEOUT}초 안에 정상 종료되지 않아" \
          "이 세션만 SIGTERM으로 종료합니다(다른 세션·PostgreSQL 서비스는 그대로 둠)..."
      kill -TERM "$SESSION_PID" 2>/dev/null || true
      if ! wait_pid_with_timeout "$SESSION_PID" "$CLEANUP_KILL_TIMEOUT"; then
        log "SIGTERM에도 반응이 없어 이 세션만 SIGKILL로 강제 종료합니다(PID=$SESSION_PID)..."
        kill -KILL "$SESSION_PID" 2>/dev/null || true
        wait_pid_with_timeout "$SESSION_PID" 3 || true
      fi
    fi
  else
    exec 3>&- 2>/dev/null || true
  fi
  wait "$SESSION_PID" 2>/dev/null || true  # 좀비 제거 — 이미 죽었으면 즉시 반환, 여기서 또 기다리지 않음
}
trap 'rc=$?; stop_session; rm -rf "$WORK_DIR"; exit $rc' EXIT

wait_for_marker() {  # $1=marker문자열 $2=제한초 — SESSION_OUT에 그 마커가 나타날 때까지 대기
  local marker="$1" timeout="$2" waited=0
  while ! grep -qF "$marker" "$SESSION_OUT" 2>/dev/null; do
    if ! kill -0 "$SESSION_PID" 2>/dev/null; then
      die "psql 세션이 예기치 않게 종료됐습니다 — 아래 출력을 확인하세요:\n$(cat "$SESSION_OUT")"
    fi
    sleep 0.2
    waited=$((waited + 1))
    if [ "$waited" -ge $((timeout * 5)) ]; then
      die "psql 세션 응답을 ${timeout}초 안에 받지 못했습니다(마커: $marker) — 이 세션만 정리하고 중단합니다."
    fi
  done
}

log "[1/5] 덤프와 동일 스냅샷을 공유할 트랜잭션 시작..."
{
  echo "BEGIN ISOLATION LEVEL REPEATABLE READ;"
  echo "SELECT pg_export_snapshot();"
  echo "SELECT '___SNAPSHOT_READY___';"
} >&3
wait_for_marker "___SNAPSHOT_READY___" "$SNAPSHOT_READY_TIMEOUT"
# SESSION_OUT 줄 구성: BEGIN은 -tA에서 출력 없음 → 1번째 줄=스냅샷 id, 2번째 줄=마커
SNAPSHOT_ID="$(sed -n '1p' "$SESSION_OUT" | tr -d '[:space:]')"
[ -n "$SNAPSHOT_ID" ] || die "pg_export_snapshot() 결과를 읽지 못했습니다: $(cat "$SESSION_OUT")"
log "  스냅샷: $SNAPSHOT_ID"

log "[2/5] pg_dump(custom, 같은 스냅샷) 실행 중..."
pg_dump --format=custom --snapshot="$SNAPSHOT_ID" --file="$DUMP_FILE" "$APP_DB"
chmod 600 "$DUMP_FILE"

log "[3/5] 같은 스냅샷 안에서 테이블별 정확한 count(*) 집계 중(스키마로 동명 테이블 구분)..."
# 주의: 여기서 SESSION_OUT을 ": > 파일"로 비우면 안 된다 — 백그라운드 psql은 이미 그 파일을
# 자기 fd로 열어 어떤 위치(오프셋)에 이어 쓰고 있는데, 경로로 다시 열어 비우는 것은 그 fd의
# 오프셋을 되돌리지 못해 이후 psql이 쓰는 내용 앞에 그만큼의 NUL 바이트(구멍)가 생기는 문제를
# 실제 서버에서 확인했다. 대신 지금까지 쓰인 바이트 수를 기록해 두고, 이후에는 그 지점 "다음"
# 부분만 잘라서 본다(파일 자체는 건드리지 않음).
PHASE1_SIZE="$(wc -c < "$SESSION_OUT" | tr -d ' ')"
{
  cat <<'SQL'
DO $$
DECLARE r record; cnt bigint;
BEGIN
  -- CREATE TEMP TABLE을 먼저 하면 바로 아래 "사용자 테이블 목록" 조회가 방금 만든 그 임시
  -- 테이블 자신까지 사용자 테이블인 것처럼 잡아버리는 자기 참조 문제가 실제 서버에서 확인됐다
  -- — pg_temp_*/pg_toast_temp_* 스키마를 제외하고, 이름으로도 한 번 더 걸러 이중으로 막는다.
  CREATE TEMP TABLE _backup_manifest_counts(schema_name text, table_name text, row_count bigint) ON COMMIT DROP;
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND n.nspname NOT LIKE 'pg\_temp\_%'
      AND n.nspname NOT LIKE 'pg\_toast\_temp\_%'
      AND c.relname <> '_backup_manifest_counts'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', r.schema_name, r.table_name) INTO cnt;
    INSERT INTO _backup_manifest_counts VALUES (r.schema_name, r.table_name, cnt);
  END LOOP;
END $$;
SELECT schema_name || '.' || table_name || E'\t' || row_count FROM _backup_manifest_counts ORDER BY 1;
SQL
  echo "SELECT '___COUNTS_READY___';"
} >&3
wait_for_marker "___COUNTS_READY___" "$COUNTS_READY_TIMEOUT"

log "[4/5] 매니페스트 파일 작성 중(실제 행 데이터는 담지 않음, 개수만)..."
# -a: psql 세션 출력에 간혹 섞이는 제어 문자 때문에 grep이 "binary file matches"로 건너뛰는 걸
# 방지(텍스트로 강제 취급). AL2023 기본 이미지엔 Node.js가 없고 python3은 기본 포함이므로
# (dnf 자체가 python3 의존) JSON 생성은 python3로 한다 — node 의존은 API 배포(별도 후속 작업)
# 몫으로 남겨 두고 이 백업 스크립트 자체는 그것 없이도 동작해야 한다.
# PHASE1_SIZE 이후에 새로 쓰인 바이트만 본다(위 [3/5] 주석 참고 — 파일을 비우지 않았으므로
# 1단계 출력이 앞에 그대로 남아 있다).
tail -c "+$((PHASE1_SIZE + 1))" "$SESSION_OUT" | grep -a -v '___COUNTS_READY___' | grep -a -F "$(printf '\t')" > "$WORK_DIR/counts.tsv" || true
python3 -c "
import json, sys
out = {}
with open('$WORK_DIR/counts.tsv') as f:
    for line in f:
        line = line.rstrip('\n')
        if not line:
            continue
        idx = line.rfind('\t')
        if idx < 0:
            continue
        key = line[:idx]
        val = line[idx + 1:]
        try:
            count = int(val)
        except ValueError:
            sys.stderr.write('invalid count for ' + key + '\n'); sys.exit(1)
        if count < 0:
            sys.stderr.write('invalid count for ' + key + '\n'); sys.exit(1)
        out[key] = count
if not out:
    sys.stderr.write('집계된 테이블이 없습니다\n'); sys.exit(1)
with open('$MANIFEST_FILE', 'w') as f:
    json.dump(out, f, indent=2)
" || die "매니페스트 생성 실패 — 성공으로 표시하지 않습니다."
chmod 600 "$MANIFEST_FILE"

# 트랜잭션을 커밋(=임시 테이블 정리 및 스냅샷 해제)하고 세션 종료(정상 경로 — 보통 즉시 끝남)
echo "COMMIT;" >&3
stop_session  # EXIT 트랩에서도 다시 부르지만 SESSION_STOPPED로 멱등이라 안전하게 미리 정리해 둠

log "[5/5] 압축 후 S3 업로드 중 (인스턴스 역할, s3:PutObject로 이 prefix에만)..."
gzip "$DUMP_FILE"
chmod 600 "$DUMP_FILE.gz"  # gzip이 원본 권한을 보존하지만 다른 사용자 노출 방지를 위해 한 번 더 고정
aws s3 cp "$DUMP_FILE.gz" "s3://$BUCKET_NAME/$PREFIX/$DATE.dump.gz"
aws s3 cp "$MANIFEST_FILE" "s3://$BUCKET_NAME/$PREFIX/$DATE.manifest.json"

log "완료: $DATE.dump.gz + $DATE.manifest.json"
