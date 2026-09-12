#!/bin/bash
# PostgreSQL 앱 계정(deardarling) 비밀번호를 교체하고 apps/api/.env의 DATABASE_URL을 함께
# 갱신한 뒤, 새 비밀번호 접속 성공과 예전 비밀번호 접속 거부를 실제로 확인한다.
# - 새 비밀번호는 SQL 특수문자 이슈를 피하기 위해 16진수(hex) 32자로 생성한다.
# - 원격 EC2에는 비밀번호가 담긴 파일을 남기지 않는다 — SSH stdin으로 SQL을 직접 흘려보낸다.
# - 모든 임시 값은 저장소 밖 SECRETS_DIR(0700)의 0600 파일에만 쓰고, 검증이 끝나면 지운다.
# - 실패해도 자동으로 예전 비밀번호로 되돌리지 않는다(사람이 판단해야 하는 상황으로 남긴다).
#
# 사용법: ./infra/ec2/rotate-db-password.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/api/.env"
ENV_EXAMPLE="$REPO_ROOT/apps/api/.env.example"
SYNC_ENV="$REPO_ROOT/infra/cognito/sync-env.mjs"
ENV_LIB="$REPO_ROOT/infra/cognito/env-lib.mjs"
SECRETS_DIR="/Users/tunib02/.deardarling-secrets-work"
SSH_KEY="$HOME/.ssh/deardarling-dev-ec2-key.pem"
EC2_HOST="ec2-user@13.125.155.80"
TUNNEL_SOCK="/tmp/deardarling-dev-db-tunnel.sock"
DB_ROLE="deardarling"
DB_NAME="deardarling_dev"

mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"

echo "[1/6] 현재 DATABASE_URL 구조 확인(값 미출력) 및 새 비밀번호 생성..."
OLD_URL_FILE="$SECRETS_DIR/db-url.old"
node "$ENV_LIB" get "$ENV_FILE" DATABASE_URL > "$OLD_URL_FILE"
chmod 600 "$OLD_URL_FILE"
if [ ! -s "$OLD_URL_FILE" ]; then
  echo "DATABASE_URL을 읽지 못했습니다 — 중단합니다." >&2
  exit 1
fi
NEWPW_FILE="$SECRETS_DIR/db-password.new"
node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))" > "$NEWPW_FILE"
chmod 600 "$NEWPW_FILE"

NEW_URL_FILE="$SECRETS_DIR/db-url.new"
node -e "
  const fs = require('fs');
  const oldUrl = new URL(fs.readFileSync(process.argv[1], 'utf8').trim());
  const newPw = fs.readFileSync(process.argv[2], 'utf8').trim();
  oldUrl.password = newPw;
  fs.writeFileSync(process.argv[3], oldUrl.toString());
" "$OLD_URL_FILE" "$NEWPW_FILE" "$NEW_URL_FILE"
chmod 600 "$NEW_URL_FILE"
echo "    준비 완료(값은 출력하지 않음)."

echo "[2/6] EC2에서 PostgreSQL 비밀번호 변경 중(원격에 파일 남기지 않음, stdin으로 전달)..."
SQL_FILE="$SECRETS_DIR/alter-role.sql"
node -e "
  const fs = require('fs');
  const pw = fs.readFileSync(process.argv[1], 'utf8').trim().replace(/'/g, \"''\");
  fs.writeFileSync(process.argv[2], \`ALTER ROLE ${DB_ROLE} WITH PASSWORD '\${pw}';\n\`);
" "$NEWPW_FILE" "$SQL_FILE"
chmod 600 "$SQL_FILE"

set +e
ALTER_ERR="$SECRETS_DIR/.alter-err.tmp"
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$EC2_HOST" \
  "sudo -u postgres psql -X -qtA -d $DB_NAME" < "$SQL_FILE" > /dev/null 2>"$ALTER_ERR"
ALTER_RC=$?
set -e
rm -f "$SQL_FILE"
if [ -s "$ALTER_ERR" ]; then
  grep -v "post-quantum\|store now, decrypt later\|openssh.com/pq" "$ALTER_ERR" >&2 || true
fi
rm -f "$ALTER_ERR"
if [ "$ALTER_RC" -ne 0 ]; then
  echo "ALTER ROLE 실패 — 비밀번호를 아직 바꾸지 못했습니다. .env는 그대로 두고 중단합니다." >&2
  rm -f "$NEWPW_FILE" "$NEW_URL_FILE" "$OLD_URL_FILE"
  exit 1
fi
echo "    PostgreSQL 비밀번호 변경 완료(DB 쪽)."

echo "[3/6] SSH 터널 상태 확인 중..."
if ! lsof -nP -iTCP:15432 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "    터널이 닫혀 있어 새로 엽니다(제어 소켓: $TUNNEL_SOCK)."
  ssh -f -N -M -S "$TUNNEL_SOCK" -o ExitOnForwardFailure=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new -i "$SSH_KEY" \
    -L 127.0.0.1:15432:127.0.0.1:5432 "$EC2_HOST"
  sleep 1
else
  echo "    이미 열려 있는 터널을 그대로 사용합니다."
fi
if ! lsof -nP -iTCP:15432 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "터널이 열리지 않았습니다 — 접속 검증을 진행할 수 없어 중단합니다(.env는 아직 예전 값)." >&2
  rm -f "$NEWPW_FILE" "$NEW_URL_FILE" "$OLD_URL_FILE"
  exit 1
fi

echo "[4/6] 새 비밀번호로 접속 확인 중..."
NEW_OK="$(DSN_FILE="$NEW_URL_FILE" node -e "
  const fs = require('fs');
  const { Client } = require('$REPO_ROOT/apps/api/node_modules/pg');
  const dsn = fs.readFileSync(process.env.DSN_FILE, 'utf8').trim();
  const c = new Client({ connectionString: dsn, connectionTimeoutMillis: 5000 });
  c.connect().then(() => c.query('SELECT 1')).then(() => { console.log('ok'); return c.end(); })
    .catch(() => { console.log('fail'); });
")"
if [ "$NEW_OK" != "ok" ]; then
  echo "새 비밀번호로 접속이 안 됩니다 — .env는 아직 예전 값으로 두고 중단합니다. DB 쪽 비밀번호는" \
       "이미 바뀐 상태이니 직접 확인이 필요합니다." >&2
  rm -f "$NEWPW_FILE" "$NEW_URL_FILE" "$OLD_URL_FILE"
  exit 1
fi
echo "    새 비밀번호 접속 성공 확인."

echo "[5/6] apps/api/.env의 DATABASE_URL 갱신 중..."
node "$SYNC_ENV" "$ENV_FILE" "$ENV_EXAMPLE" "DATABASE_URL=$NEW_URL_FILE"

echo "[6/6] 예전 비밀번호 접속 거부 확인 중..."
OLD_REJECTED="$(DSN_FILE="$OLD_URL_FILE" node -e "
  const fs = require('fs');
  const { Client } = require('$REPO_ROOT/apps/api/node_modules/pg');
  const dsn = fs.readFileSync(process.env.DSN_FILE, 'utf8').trim();
  const c = new Client({ connectionString: dsn, connectionTimeoutMillis: 5000 });
  c.connect().then(() => c.query('SELECT 1')).then(() => { console.log('unexpectedly-succeeded'); return c.end(); })
    .catch(() => { console.log('rejected'); });
")"
rm -f "$OLD_URL_FILE"
if [ "$OLD_REJECTED" != "rejected" ]; then
  echo "경고: 예전 비밀번호가 여전히 접속됩니다 — 확인이 필요합니다(값은 출력하지 않음)." >&2
  exit 1
fi
echo "    예전 비밀번호 접속 거부 확인됨."

rm -f "$NEWPW_FILE"
echo "완료 — PostgreSQL 비밀번호 교체 및 DATABASE_URL 갱신, 새/예전 비밀번호 접속 검증까지 끝났습니다."
