#!/bin/bash
# 로컬 머신(관리자/사용자 본인 컴퓨터)에서 실행한다. 흐름:
#   tunibridge 프로필로 S3에서 최신 백업 다운로드(로컬) → scp로 서버에 안전하게 전송
#   → ssh로 restore-on-server.sh를 원격 실행(복원·검증·정리는 서버에서, postgres 슈퍼유저로).
#
# 핵심 규칙:
# - 개인 AWS 액세스 키를 서버에 복사하거나 등록하지 않는다 — S3 다운로드는 이 로컬 머신에서
#   본인의 tunibridge 자격증명으로만 하고, 서버에는 이미 내려받은 파일만 scp로 전달한다.
# - 복원 자체(createdb/pg_restore/dropdb)는 서버 위 restore-on-server.sh가 처리하며, 그 스크립트가
#   원본 운영 DB 이름으로는 복원하지 못하도록 이미 막고 있다(이중 방어).
# - 실제 행 데이터는 로컬에도, 이 스크립트의 출력에도 남기지 않는다.
#
# 사전 조건: aws configure --profile tunibridge 완료(S3 GetObject 권한 필요 — 인스턴스 역할이 아니라
#           이 로컬 사용자 본인 권한, infra/ec2/README.md 참고), create-dev-server.sh가 만든
#           SSH 키(기본 ~/.ssh/deardarling-dev-ec2-key.pem — 프로젝트 디렉터리 밖에 보관해
#           git 저장소와 분리한다), ADMIN_SSH_CIDR로 허용된 위치에서 실행.
#
# 사용법: EC2_HOST=1.2.3.4 ./infra/ec2/backup-restore-drill.sh [백업파일명(기본: 최신)]

set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-tunibridge}"
REGION="${AWS_REGION_OVERRIDE:-ap-northeast-2}"
BUCKET_NAME="deardarling-dev-backups-539746929196-ap-northeast-2"
PREFIX="postgres/dev/"
if [ -z "${EC2_HOST:-}" ]; then
  echo "EC2_HOST 환경변수(서버의 Elastic IP 또는 도메인)가 필요합니다." >&2
  exit 1
fi
SSH_USER="${SSH_USER:-ec2-user}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/deardarling-dev-ec2-key.pem}"
[ -f "$SSH_KEY" ] || { echo "SSH 키가 없습니다: $SSH_KEY (create-dev-server.sh 실행 결과물, ~/.ssh에 보관)" >&2; exit 1; }

aws_cmd() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

SCRATCH_DIR="$(mktemp -d)"
trap 'rc=$?; rm -rf "$SCRATCH_DIR"; exit $rc' EXIT  # 정리 명령이 원래 실패 종료코드를 0으로 덮지 않게

echo "[1/4] 백업 목록 조회 중 (tunibridge 프로필, 본인 권한으로 다운로드 — 인스턴스 역할 아님)..."
OBJECT_NAME="${1:-}"
if [ -z "$OBJECT_NAME" ]; then
  OBJECT_NAME="$(aws_cmd s3 ls "s3://$BUCKET_NAME/$PREFIX" | awk '{print $4}' | grep '\.dump\.gz$' | sort | tail -1)"
  [ -n "$OBJECT_NAME" ] || { echo "백업 객체를 찾지 못했습니다." >&2; exit 1; }
fi
echo "    대상: $OBJECT_NAME"

echo "[2/4] 로컬로 다운로드 중 (커밋되지 않는 임시 디렉터리)..."
aws_cmd s3 cp "s3://$BUCKET_NAME/$PREFIX$OBJECT_NAME" "$SCRATCH_DIR/$OBJECT_NAME"
MANIFEST_NAME="${OBJECT_NAME%.dump.gz}.manifest.json"
aws_cmd s3 cp "s3://$BUCKET_NAME/$PREFIX$MANIFEST_NAME" "$SCRATCH_DIR/$MANIFEST_NAME" 2>/dev/null \
  || echo "    매니페스트 없음 — row count 비교는 서버 쪽에서 미확인으로 처리됨"

echo "[3/4] 서버로 전송 중 (scp, AWS 키는 전달하지 않음)..."
REMOTE_TMP="/tmp/restore-drill-$$"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=yes "$SSH_USER@$EC2_HOST" "mkdir -p $REMOTE_TMP && chmod 700 $REMOTE_TMP"
scp -i "$SSH_KEY" "$SCRATCH_DIR/$OBJECT_NAME" "$SSH_USER@$EC2_HOST:$REMOTE_TMP/"
[ -f "$SCRATCH_DIR/$MANIFEST_NAME" ] && scp -i "$SSH_KEY" "$SCRATCH_DIR/$MANIFEST_NAME" "$SSH_USER@$EC2_HOST:$REMOTE_TMP/" || true
scp -i "$SSH_KEY" "$SCRIPT_DIR/restore-on-server.sh" "$SSH_USER@$EC2_HOST:$REMOTE_TMP/"

echo "[4/4] 서버에서 복원·검증·정리 실행 중 (postgres 슈퍼유저, row count만 출력)..."
ssh -i "$SSH_KEY" "$SSH_USER@$EC2_HOST" \
  "chmod +x $REMOTE_TMP/restore-on-server.sh && sudo $REMOTE_TMP/restore-on-server.sh $REMOTE_TMP/$OBJECT_NAME; RC=\$?; rm -rf $REMOTE_TMP; exit \$RC"

echo "완료 — 결과는 위 서버 출력 참고(행 데이터는 출력되지 않았습니다)."
