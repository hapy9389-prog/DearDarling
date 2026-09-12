#!/bin/bash
# EC2 인스턴스 "안에서" 루트로 실행하는 스크립트다(로컬 머신에서 실행하지 않음 — SSH로 접속해
# 이 파일을 서버에 올린 뒤 `sudo ./provision-postgres.sh`로 실행하거나 user-data로 넘긴다).
#
# 핵심 규칙:
# - 데이터 볼륨이 마운트돼 있는지 먼저 확인한다. 안 됐으면 즉시 중단한다 — 절대로 루트 볼륨
#   위의 다른 경로에 새로 초기화하지 않는다(디스크가 붙지 않았는데 "성공"해버리는 사고 방지).
# - PostgreSQL 16 관련 실행 파일·서비스 이름은 하드코딩하지 않고, 설치된 RPM 패키지가 실제로
#   담고 있는 파일 목록(`rpm -ql`)에서 찾아 쓴다 — 패키지 버전에 따라 이름이 달라질 수 있어서다.
# - PGDATA에 이미 PG_VERSION 파일이 있으면(이미 초기화된 클러스터) initdb를 다시 하지 않는다 —
#   재실행해도 기존 파일시스템·DB를 절대 포맷/재초기화하지 않는다.
# - `--verify`로 실행하면 아무것도 바꾸지 않고 마운트·서비스·데이터 존재만 확인한다.
#
# 사용법: sudo ./provision-postgres.sh          # 설치·초기화(멱등)
#         sudo ./provision-postgres.sh --verify # 확인만(재부팅 뒤 데이터 보존 검증 등에 사용)

set -euo pipefail

DATA_MOUNT="${DATA_MOUNT:-/data}"
PG_MAJOR="${PG_MAJOR:-16}"
PGDATA="${PGDATA:-$DATA_MOUNT/pgsql/$PG_MAJOR/data}"
APP_DB="${APP_DB:-deardarling_dev}"
APP_DB_USER="${APP_DB_USER:-deardarling}"
PG_OS_USER="${PG_OS_USER:-postgres}"

MODE="install"
[ "${1:-}" = "--verify" ] && MODE="verify"

log() { echo "[provision-postgres] $*"; }
die() { echo "[provision-postgres] 오류: $*" >&2; exit 1; }

require_mount() {
  mountpoint -q "$DATA_MOUNT" || die \
    "데이터 볼륨이 $DATA_MOUNT 에 마운트돼 있지 않습니다 — 다른 경로에 초기화하지 않고 중단합니다. " \
    "/etc/fstab과 'lsblk'로 확인하세요(UUID 마운트, nofail 미사용이 기대값)."
}

if [ "$MODE" = "verify" ]; then
  log "검증 모드 — 아무것도 바꾸지 않습니다."
  require_mount
  log "  [OK] $DATA_MOUNT 마운트됨"
  [ -f "$PGDATA/PG_VERSION" ] || die "$PGDATA/PG_VERSION 이 없습니다 — 클러스터가 초기화되지 않은 것으로 보입니다."
  log "  [OK] $PGDATA/PG_VERSION 존재 (버전: $(cat "$PGDATA/PG_VERSION"))"
  SERVICE_NAME="$(systemctl list-unit-files 2>/dev/null | awk '/postgresql.*\.service/{print $1; exit}')"
  [ -n "$SERVICE_NAME" ] || die "postgresql 계열 systemd 유닛을 찾지 못했습니다."
  systemctl is-active --quiet "$SERVICE_NAME" || die "$SERVICE_NAME 이 active 상태가 아닙니다."
  log "  [OK] $SERVICE_NAME active"
  log "  [OK] 재부팅 전후 비교는 $PGDATA/PG_VERSION의 mtime과 row count 매니페스트(백업 스크립트가 남김)를 직접 비교하세요."
  exit 0
fi

log "[1/6] 데이터 볼륨 마운트 확인 중..."
require_mount
log "  OK: $DATA_MOUNT 마운트됨"

log "[2/6] postgresql${PG_MAJOR}-server 패키지 확인/설치 중..."
if ! rpm -q "postgresql${PG_MAJOR}-server" >/dev/null 2>&1; then
  dnf install -y "postgresql${PG_MAJOR}" "postgresql${PG_MAJOR}-server" "postgresql${PG_MAJOR}-contrib"
fi
rpm -q "postgresql${PG_MAJOR}-server" >/dev/null 2>&1 || die "postgresql${PG_MAJOR}-server 설치 확인 실패"

log "[3/6] 패키지가 실제로 제공하는 초기화 명령·서비스 이름을 확인 중(하드코딩하지 않음)..."
# 패키지가 담고 있는 파일 목록에서 "...setup" 실행 파일을 찾는다(예: /usr/bin/postgresql-16-setup).
# "/bin/"으로 시작하는 경로만 받는다 — /etc/postgresql-setup(설정 디렉터리)도 이름이 비슷해
# 잘못 걸릴 수 있음을 실제 AL2023 인스턴스에서 확인했다(실행 파일이 아니라 디렉터리라 실패).
SETUP_BIN="$(rpm -ql "postgresql${PG_MAJOR}-server" | grep -E '/bin/(postgresql|pg)[^/]*setup$' | head -1 || true)"
INITDB_BIN="$(rpm -ql "postgresql${PG_MAJOR}-server" | grep -E '/bin/initdb$' || true)"
SERVICE_FILE="$(rpm -ql "postgresql${PG_MAJOR}-server" | grep -E '/systemd/system/.*\.service$' | head -1 || true)"
if [ -n "$SERVICE_FILE" ]; then
  SERVICE_NAME="$(basename "$SERVICE_FILE")"
else
  # 패키지가 서비스 파일을 직접 담지 않는 배포도 있어, 설치 후 등록된 유닛에서 이름을 찾는 걸 보조 수단으로 둔다.
  SERVICE_NAME="$(systemctl list-unit-files 2>/dev/null | awk '/postgresql.*\.service/{print $1; exit}')"
fi
[ -n "$SERVICE_NAME" ] || die "패키지에서 systemd 서비스 유닛을 찾지 못했습니다 — 수동 확인 필요(문서 유추로 진행하지 않음)."
log "  발견됨: SETUP_BIN=${SETUP_BIN:-없음} INITDB_BIN=${INITDB_BIN:-없음} SERVICE_NAME=$SERVICE_NAME"

log "[4/6] systemd 유닛에 PGDATA·마운트 의존성 등록 중 (initdb보다 먼저 — 이유는 아래 참고)..."
# AL2023의 postgresql-setup은 PGDATA를 커맨드라인 옵션이 아니라 "systemd 유닛에 설정된
# Environment=PGDATA=..."에서 읽어 결정한다(실제 인스턴스에서 확인 — PGSETUP_INITDB_OPTIONS="-D ..."
# 로 넘기면 initdb 자체는 그 경로에 성공하지만 postgresql-setup의 마무리 검증이 "PGDATA가 설정 안 됨"
# 으로 보고 실패 처리한다). 그래서 드롭인으로 PGDATA를 먼저 지정해 systemd가 "정답"을 알게 한 뒤
# initdb를 호출한다 — 이러면 postgresql-setup이 그 경로를 스스로 읽어 쓴다.
mkdir -p "/etc/systemd/system/${SERVICE_NAME}.d"
cat > "/etc/systemd/system/${SERVICE_NAME}.d/override.conf" <<EOF
[Unit]
RequiresMountsFor=$DATA_MOUNT

[Service]
Environment=PGDATA=$PGDATA
EOF
systemctl daemon-reload
log "  등록됨: PGDATA=$PGDATA, RequiresMountsFor=$DATA_MOUNT"

log "[5/6] 클러스터 초기화 여부 확인 중..."
if [ -f "$PGDATA/PG_VERSION" ]; then
  log "  이미 초기화됨($PGDATA/PG_VERSION 존재) — initdb를 건너뜁니다(재포맷하지 않음)."
elif [ -d "$PGDATA" ] && [ -n "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  die "$PGDATA 가 이미 존재하고 비어있지 않은데 PG_VERSION이 없습니다 — 알 수 없는 상태이므로" \
      " 자동으로 초기화하지 않고 중단합니다. 직접 확인하세요."
else
  log "  초기화되지 않음 — initdb 수행"
  mkdir -p "$(dirname "$PGDATA")"
  chown -R "$PG_OS_USER:$PG_OS_USER" "$DATA_MOUNT/pgsql"
  if [ -n "$SETUP_BIN" ]; then
    "$SETUP_BIN" --initdb
  elif [ -n "$INITDB_BIN" ]; then
    sudo -u "$PG_OS_USER" "$INITDB_BIN" -D "$PGDATA"
  else
    die "초기화 실행 파일을 찾지 못해 안전하게 진행할 수 없습니다(문서 유추로 강행하지 않음)."
  fi
  [ -f "$PGDATA/PG_VERSION" ] || die "initdb 이후에도 PG_VERSION이 없습니다 — 초기화 실패."
  log "  초기화 완료: $(cat "$PGDATA/PG_VERSION")"
fi

log "[6/6] 외부 노출 방지 설정 후 서비스 시작..."
CONF="$PGDATA/postgresql.conf"
HBA="$PGDATA/pg_hba.conf"
if [ -f "$CONF" ]; then
  grep -q "^listen_addresses" "$CONF" && sed -i "s/^listen_addresses.*/listen_addresses = 'localhost'/" "$CONF" \
    || echo "listen_addresses = 'localhost'" >> "$CONF"
fi
if [ -f "$HBA" ]; then
  if ! grep -qE '^\s*(host|hostssl)\s+\S+\s+\S+\s+0\.0\.0\.0/0' "$HBA"; then
    log "  pg_hba.conf에 0.0.0.0/0 규칙 없음(정상)"
  else
    die "pg_hba.conf에 0.0.0.0/0 규칙이 있습니다 — 외부 접속을 허용하는 설정이므로 중단합니다."
  fi
fi
systemctl enable --now "$SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" || die "$SERVICE_NAME 시작 실패"
log "  $SERVICE_NAME 실행 중"

log "[6/6] pgcrypto 확장·앱 DB/사용자 확인(멱등 — 이미 있으면 건드리지 않음)..."
# CREATE ROLE·CREATE DATABASE는 반드시 별도의 psql -c 호출로 나눈다 — 세미콜론으로 묶어 하나의
# -c에 넘기면 암묵적 트랜잭션 블록으로 처리돼 "CREATE DATABASE cannot run inside a transaction
# block" 오류가 난다(실제 인스턴스에서 확인).
sudo -u "$PG_OS_USER" psql -v ON_ERROR_STOP=1 -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname = '$APP_DB_USER'" | grep -q 1 \
  || sudo -u "$PG_OS_USER" psql -v ON_ERROR_STOP=1 -c "CREATE ROLE $APP_DB_USER LOGIN;"
sudo -u "$PG_OS_USER" psql -v ON_ERROR_STOP=1 -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$APP_DB'" | grep -q 1 \
  || sudo -u "$PG_OS_USER" createdb -O "$APP_DB_USER" "$APP_DB"
sudo -u "$PG_OS_USER" psql -v ON_ERROR_STOP=1 -d "$APP_DB" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

log "완료. 검증: sudo ./provision-postgres.sh --verify, 그리고 서버 재부팅 후 다시 --verify로" \
    " 마운트·서비스·PG_VERSION이 그대로인지 확인하세요(실제 인스턴스 없이는 이번 세션에서 실행하지 못했습니다)."
