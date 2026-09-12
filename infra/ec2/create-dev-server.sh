#!/bin/bash
# DearDarling 개발용 EC2(웹·API·PostgreSQL 단일 서버) + 백업용 S3 버킷을 준비한다.
#
# 두 가지 모드:
#   --check   읽기 전용 조회 + (지원되는 곳만) --dry-run 권한 확인만 한다. 어떤 자원도
#             만들거나 바꾸지 않는다 — 언제 실행해도 안전하다.
#   (기본)     실제 생성/재사용을 수행한다. infra/cognito의 관례와 동일하게 idempotent하다:
#             이미 있는 자원은 태그·소속을 다시 확인한 뒤에만 재사용하고, 이름이 여러 개
#             겹치면 어떤 것도 임의로 고르지 않고 중단한다.
#
# 핵심 규칙(infra/cognito와 동일한 원칙):
# - List/Describe가 실패하면(권한 부족·통신 오류 등 이유 불문) "없다"로 취급하지 않고 중단한다.
# - 생성 응답을 확인하지 못한 채 끝나면(네트워크 끊김 등) 다음 실행에서 자동 재시도하지 않고
#   사람 확인을 요구한다(특히 데이터 볼륨 — 재생성하면 새 빈 볼륨이 되어 데이터가 갈라진다).
# - 데이터 EBS 볼륨 ID는 상태 파일에 기록된 뒤에는 절대 새로 만들지 않는다 — 재실행은 항상
#   같은 볼륨을 재사용한다(포맷·재초기화 방지는 이 스크립트가 아니라 서버 위 provision-postgres.sh의
#   책임이지만, 애초에 매번 다른 볼륨이 붙으면 그 안전장치가 무의미해지므로 여기서부터 막는다).
# - IAM 역할·인스턴스 프로파일은 이 스크립트가 만들지 않는다(admin 전용, README 참고) — 이미
#   존재하는지 확인만 하고, 없으면 정확한 요청 내용을 출력하고 중단한다.
# - 비밀값(키 페어 프라이빗 키)은 화면에 출력하지 않고, 프로젝트 디렉터리 밖 `~/.ssh/`에
#   0400 파일로만 저장한다(LOCAL_KEY_FILE_OVERRIDE로 자체 테스트만 예외적으로 경로를 바꿈).
#
# 사전 조건: aws configure --profile tunibridge 완료, ADMIN_SSH_CIDR 환경변수 설정
#           (예: ADMIN_SSH_CIDR=1.2.3.4/32), IAM 역할·인스턴스 프로파일은 admin이 미리 생성.
#
# SKIP_IAM_AND_BACKUP=yes : IAM 역할·인스턴스 프로파일 확인과 S3 백업 버킷 생성을 명시적으로
#   건너뛴다(둘 다 admin 조치나 별도 준비가 끝나기 전 상태) — 인스턴스는 인스턴스 프로파일 없이
#   생성되고, 그 결과 "PostgreSQL 백업이 아직 S3로 자동 업로드되지 않는다"는 사실을
#   완료 메시지에 **미완료로 명시** 한다(조용히 생략하지 않음). admin이 역할·프로파일을 만든
#   뒤에는 이 변수 없이 재실행하면 같은 인스턴스에 역할을 붙이고 버킷·백업을 이어서 준비한다.
#
# 사용법:
#   ADMIN_SSH_CIDR=1.2.3.4/32 ./infra/ec2/create-dev-server.sh --check   # 안전, 언제나 가능
#   ADMIN_SSH_CIDR=1.2.3.4/32 ./infra/ec2/create-dev-server.sh           # 실제 생성/재사용(IAM 필요)
#   ADMIN_SSH_CIDR=1.2.3.4/32 SKIP_IAM_AND_BACKUP=yes ./infra/ec2/create-dev-server.sh
#                                                                        # IAM·백업 없이 EC2만

set -euo pipefail

EXPECTED_ACCOUNT_ID="539746929196"   # tunibaws
EXPECTED_REGION="ap-northeast-2"     # 서울

PROFILE="${AWS_PROFILE_OVERRIDE:-tunibridge}"
REGION="${AWS_REGION_OVERRIDE:-ap-northeast-2}"

ROLE_NAME="deardarling-dev-ec2-role"
INSTANCE_PROFILE_NAME="deardarling-dev-ec2-profile"
SG_NAME="deardarling-dev-ec2-sg"
KEY_NAME="deardarling-dev-ec2-key"
INSTANCE_NAME="deardarling-dev-ec2"
BUCKET_NAME="deardarling-dev-backups-539746929196-ap-northeast-2"
EXPECT_TAG_PROJECT="DearDarling"
EXPECT_TAG_ENV="dev"
ROOT_VOLUME_SIZE_GB="${ROOT_VOLUME_SIZE_GB:-20}"
DATA_VOLUME_SIZE_GB="${DATA_VOLUME_SIZE_GB:-20}"
INSTANCE_TYPE="t4g.small"

MODE="create"
for a in "$@"; do
  if [ "$a" = "--check" ]; then MODE="check"; fi
done
SKIP_IAM_AND_BACKUP="${SKIP_IAM_AND_BACKUP:-no}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 자체 테스트는 이 스크립트와 필요한 *.params.json을 임시 디렉터리에 복사해 실행한다 — 그러면
# SCRIPT_DIR·STATE_FILE이 자동으로 그 임시 디렉터리를 가리켜, 실제 infra/ec2/state.local.json을
# 건드리지 않고 격리된다(별도 --repo-root 옵션 불필요).
STATE_FILE="$SCRIPT_DIR/state.local.json"
TMP_DIR="$(mktemp -d)"
chmod 700 "$TMP_DIR"
trap 'rc=$?; rm -rf "$TMP_DIR"; exit $rc' EXIT
# (주의: EXIT 트랩의 마지막 명령 종료코드가 스크립트 전체 종료코드를 덮어써 버리는 bash 특성이
# 있어, 트랩 진입 시점의 $?를 rc에 저장해 뒀다가 끝에 그대로 다시 exit한다 — 그냥
# `trap 'rm -rf "$TMP_DIR"' EXIT`로 두면 정리 명령이 성공(0)한 순간 원래 실패(중단) 종료코드가
# 0으로 뒤바뀌어, 이 스크립트를 호출하는 쪽이 실패를 감지하지 못하는 사고가 생긴다.

aws_cmd() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

DRYRUN_FLAG=""
[ "$MODE" = "check" ] && DRYRUN_FLAG="--dry-run"
# 참고: bash 3.2(구형 macOS 기본값)는 nounset(set -u) 상태에서 빈 배열의 "${arr[@]}" 확장을
# "unbound variable"로 잘못 취급하는 알려진 버그가 있다 — 그래서 배열 대신 문자열로 두고
# 아래에서 따옴표 없이 확장한다(값은 항상 ""나 "--dry-run" 중 하나뿐이라 단어분리 문제 없음).

# --dry-run이 걸린 EC2 호출을 분류해서 사람이 읽을 결과로 출력한다.
# 반환값: 0=DryRunOperation(권한 있음/실제로는 아무것도 안 만듦), 1=UnauthorizedOperation(권한 없음),
#         2=그 외(인자·자원 문제일 수 있음 — 권한 판정 아님)
classify_dryrun() {
  local desc="$1" out="$2"
  if echo "$out" | grep -q "DryRunOperation"; then
    echo "    [OK] $desc — DryRunOperation(이 요청 범위에서 인증 통과, 아무것도 만들지 않음)"
    return 0
  elif echo "$out" | grep -q "UnauthorizedOperation"; then
    echo "    [권한 없음] $desc — UnauthorizedOperation" >&2
    return 1
  else
    echo "    [확인 불가] $desc — DryRun 판정이 아닌 다른 오류(인자·자원 문제일 수 있음):" >&2
    echo "$out" | head -3 >&2
    return 2
  fi
}

state_get() {
  node -e "
    const fs=require('fs');
    if(!fs.existsSync('$STATE_FILE')){process.stdout.write('');process.exit(0);}
    const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
    const v = s['$1'];
    // 객체 값(pendingInstanceParams 등)은 String(v)로 읽으면 '[object Object]'가 되므로
    // JSON.stringify로 직렬화한다 — 원시값(문자열/숫자/불리언)은 그대로 String()으로 충분하다.
    process.stdout.write(v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  "
}
state_set() {
  node -e "
    const fs = require('fs');
    const s = fs.existsSync('$STATE_FILE') ? JSON.parse(fs.readFileSync('$STATE_FILE','utf8')) : {};
    s['$1'] = $2;
    const tmp = '$STATE_FILE.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, '$STATE_FILE');
  "
}
state_del() {
  node -e "
    const fs = require('fs');
    if(!fs.existsSync('$STATE_FILE')) process.exit(0);
    const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
    delete s['$1'];
    const tmp = '$STATE_FILE.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, '$STATE_FILE');
  "
}

echo "[1/9] 신원·계정·리전 확인 중..."
CALLER_JSON="$TMP_DIR/caller.json"
aws_cmd sts get-caller-identity --output json > "$CALLER_JSON"
ACCOUNT_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CALLER_JSON','utf8')).Account)")"
CALLER_ARN="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CALLER_JSON','utf8')).Arn)")"
if [ "$ACCOUNT_ID" != "$EXPECTED_ACCOUNT_ID" ] || [ "$REGION" != "$EXPECTED_REGION" ]; then
  echo "승인된 회사 계정($EXPECTED_ACCOUNT_ID)/리전($EXPECTED_REGION)이 아닙니다" \
       "(현재: $ACCOUNT_ID/$REGION) — 중단합니다." >&2
  exit 1
fi
echo "    Account=$ACCOUNT_ID(확인됨) Region=$REGION(확인됨) Caller=$CALLER_ARN"

[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

echo "[2/9] IAM 인스턴스 역할·프로파일 확인 중 (이 스크립트는 이걸 만들지 않음 — admin 전용)..."
IAM_PROFILE_READY="no"
if [ "$SKIP_IAM_AND_BACKUP" = "yes" ]; then
  echo "    [건너뜀] SKIP_IAM_AND_BACKUP=yes — IAM 역할·인스턴스 프로파일 확인/사용을 이번 실행에서" \
       "생략한다(admin 조치 후 이 변수 없이 재실행하면 이어서 붙임). ***미완료: 인스턴스에 역할이" \
       "없으므로 S3 자동 백업도 이번엔 설정하지 않는다(아래 [5/9]).***"
else
  ROLE_OK="no"
  if aws_cmd iam get-role --role-name "$ROLE_NAME" --output json > "$TMP_DIR/role.json" 2>"$TMP_DIR/role.err"; then
    ROLE_OK="yes"
  fi
  PROFILE_OK="no"
  if aws_cmd iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" --output json > "$TMP_DIR/profile.json" 2>"$TMP_DIR/profile.err"; then
    PROFILE_OK="yes"
  fi
  if [ "$ROLE_OK" != "yes" ] || [ "$PROFILE_OK" != "yes" ]; then
    cat >&2 <<EOF
IAM 역할($ROLE_NAME) 또는 인스턴스 프로파일($INSTANCE_PROFILE_NAME)이 아직 없습니다
(역할 조회: $ROLE_OK, 프로파일 조회: $PROFILE_OK). 이 스크립트는 IAM 역할을 만들지 않습니다 —
admin에게 아래 파일 내용 그대로 생성을 요청하세요:
  - 신뢰 정책: infra/ec2/instance-role-trust-policy.json
  - 인라인 정책: infra/ec2/instance-role-inline-policy.json
  - 그리고 이 호출자($CALLER_ARN)에게 infra/ec2/passrole-policy-request.json 내용의 PassRole 권한
자세한 요청 문구는 infra/ec2/README.md "관리자에게 보낼 요청" 절 참고.
IAM 준비 없이 EC2만 먼저 만들려면 SKIP_IAM_AND_BACKUP=yes로 재실행하세요(백업은 미완료로 남음).
EOF
    exit 1
  fi
  IAM_PROFILE_READY="yes"
  echo "    역할·프로파일 확인됨"
fi

echo "[3/9] 기본 VPC·서브넷 확인 중..."
aws_cmd ec2 describe-vpcs --filters Name=is-default,Values=true --output json > "$TMP_DIR/vpcs.json"
VPC_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/vpcs.json','utf8')).Vpcs.length)")"
if [ "$VPC_COUNT" != "1" ]; then
  echo "기본 VPC가 정확히 1개가 아닙니다(발견: ${VPC_COUNT}개) — 어떤 걸 쓸지 판단할 수 없어 중단합니다." >&2
  exit 1
fi
VPC_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/vpcs.json','utf8')).Vpcs[0].VpcId)")"
aws_cmd ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=default-for-az,Values=true" --output json > "$TMP_DIR/subnets.json"
SUBNET_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/subnets.json','utf8')).Subnets.length)")"
if [ "$SUBNET_COUNT" -lt 1 ]; then
  echo "기본 VPC($VPC_ID)에 기본 서브넷이 없습니다 — 중단합니다." >&2
  exit 1
fi
SUBNET_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/subnets.json','utf8')).Subnets[0].SubnetId)")"
echo "    VPC=$VPC_ID Subnet=$SUBNET_ID"

echo "[4/9] AMI(AL2023 arm64 일반형, 최신) 조회 중..."
aws_cmd ec2 describe-images --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023.*-arm64" "Name=state,Values=available" \
  --output json > "$TMP_DIR/images.json"
AMI_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/images.json','utf8')).Images.length)")"
if [ "$AMI_COUNT" -lt 1 ]; then
  echo "AL2023 arm64 일반형 AMI를 찾지 못했습니다 — 중단합니다." >&2
  exit 1
fi
AMI_ID="$(node -e "
  const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/images.json','utf8'));
  const sorted=d.Images.sort((a,b)=>a.CreationDate<b.CreationDate?1:-1);
  console.log(sorted[0].ImageId);
")"
ROOT_DEVICE_NAME="$(node -e "
  const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/images.json','utf8'));
  const sorted=d.Images.sort((a,b)=>a.CreationDate<b.CreationDate?1:-1);
  console.log(sorted[0].RootDeviceName);
")"
echo "    AMI=$AMI_ID RootDeviceName=$ROOT_DEVICE_NAME(하드코딩하지 않고 AMI에서 직접 읽음)"

echo "[5/9] 백업용 S3 버킷($BUCKET_NAME) 확인/생성 중..."
if [ "$SKIP_IAM_AND_BACKUP" = "yes" ]; then
  echo "    [건너뜀] SKIP_IAM_AND_BACKUP=yes — S3 버킷을 만들지 않는다." \
       "***미완료: PostgreSQL 논리 백업의 S3 자동 업로드가 아직 설정되지 않음.***"
else
BUCKET_STATE="$(state_get bucketReady)"
if [ "$BUCKET_STATE" = "true" ]; then
  if ! aws_cmd s3api head-bucket --bucket "$BUCKET_NAME" 2>"$TMP_DIR/hb.err"; then
    echo "상태 파일은 버킷이 준비됐다고 기록돼 있지만 실제로 head-bucket이 실패합니다 — 중단합니다." >&2
    cat "$TMP_DIR/hb.err" >&2
    exit 1
  fi
  aws_cmd s3api get-bucket-tagging --bucket "$BUCKET_NAME" --output json > "$TMP_DIR/tags.json" 2>"$TMP_DIR/tags.err" || {
    echo "버킷 태그를 확인할 수 없습니다 — 재사용 전 검증 실패로 중단합니다." >&2; exit 1; }
  TAG_OK="$(node -e "
    const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/tags.json','utf8'));
    const t=Object.fromEntries((d.TagSet||[]).map(x=>[x.Key,x.Value]));
    console.log(t.Project==='$EXPECT_TAG_PROJECT' ? 'yes':'no');
  ")"
  [ "$TAG_OK" = "yes" ] || { echo "버킷 태그가 기대와 다릅니다 — 중단합니다." >&2; exit 1; }
  echo "    기존 버킷 재사용(태그 확인됨)"
else
  if [ "$MODE" = "check" ]; then
    echo "    [dry-run 미지원] s3:CreateBucket — DryRun 파라미터가 없어 안전한 사전 확인 불가, 건너뜀"
  else
    set +e
    CREATE_OUT="$(aws_cmd s3api create-bucket --bucket "$BUCKET_NAME" \
      --create-bucket-configuration LocationConstraint="$REGION" 2>&1)"
    CREATE_RC=$?
    set -e
    if [ $CREATE_RC -eq 0 ]; then
      echo "    새로 생성됨"
    elif echo "$CREATE_OUT" | grep -q "BucketAlreadyOwnedByYou"; then
      echo "    이미 우리 계정 소유로 존재 — 재사용"
    elif echo "$CREATE_OUT" | grep -q "BucketAlreadyExists"; then
      echo "다른 AWS 계정이 이미 이 버킷명을 선점했습니다 — 이 이름은 포기하고" \
           "BUCKET_NAME을 바꿔서 재시도해야 합니다(강행하지 않음)." >&2
      exit 1
    else
      echo "버킷 생성 실패:" >&2; echo "$CREATE_OUT" >&2; exit 1
    fi
    aws_cmd s3api put-bucket-tagging --bucket "$BUCKET_NAME" --tagging \
      "TagSet=[{Key=Project,Value=$EXPECT_TAG_PROJECT},{Key=Environment,Value=$EXPECT_TAG_ENV}]"
    aws_cmd s3api put-public-access-block --bucket "$BUCKET_NAME" \
      --public-access-block-configuration "file://$SCRIPT_DIR/bucket-public-access-block.params.json"
    aws_cmd s3api put-bucket-encryption --bucket "$BUCKET_NAME" \
      --server-side-encryption-configuration "file://$SCRIPT_DIR/bucket-encryption.params.json"
    aws_cmd s3api put-bucket-lifecycle-configuration --bucket "$BUCKET_NAME" \
      --lifecycle-configuration "file://$SCRIPT_DIR/bucket-lifecycle.params.json"
    aws_cmd s3api get-bucket-tagging --bucket "$BUCKET_NAME" --output json > "$TMP_DIR/tags2.json"
    TAG_OK2="$(node -e "
      const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/tags2.json','utf8'));
      const t=Object.fromEntries((d.TagSet||[]).map(x=>[x.Key,x.Value]));
      console.log(t.Project==='$EXPECT_TAG_PROJECT' ? 'yes':'no');
    ")"
    [ "$TAG_OK2" = "yes" ] || { echo "생성 직후 태그 재확인 실패 — 레이스 컨디션 의심, 중단합니다." >&2; exit 1; }
    state_set bucketReady "true"
    echo "    설정 완료(퍼블릭 차단/암호화/라이프사이클/태그)"
  fi
fi
fi

echo "[6/9] 보안 그룹($SG_NAME) 확인/생성 중..."
# 주의: `: "${VAR:?msg}"` 관용구는 bash 3.2(구형 macOS 기본값)에서 EXIT 트랩에 전달되는 $?를
# 0으로 되돌려 버리는 알려진 버그가 있어(트랩이 실패를 실패로 인식 못함), 명시적 if/exit로 대체한다.
if [ -z "${ADMIN_SSH_CIDR:-}" ]; then
  echo "ADMIN_SSH_CIDR 환경변수(예: 1.2.3.4/32)가 필요합니다 — SSH를 허용할 관리자 IP." >&2
  exit 1
fi
SG_ID="$(state_get sgId)"
if [ -z "$SG_ID" ]; then
  aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$SG_NAME" --output json > "$TMP_DIR/sgs.json"
  SG_MATCH="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/sgs.json','utf8')).SecurityGroups.length)")"
  if [ "$SG_MATCH" -gt 1 ]; then
    echo "이름이 $SG_NAME 인 보안 그룹이 여러 개 있어 중단합니다." >&2; exit 1
  elif [ "$SG_MATCH" -eq 1 ]; then
    SG_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/sgs.json','utf8')).SecurityGroups[0].GroupId)")"
    state_set sgId "\"$SG_ID\""
    echo "    기존 보안 그룹 재사용: $SG_ID"
  else
    OUT="$(aws_cmd ec2 create-security-group $DRYRUN_FLAG --group-name "$SG_NAME" \
      --description "DearDarling dev EC2 (web/api/postgres)" --vpc-id "$VPC_ID" --output json 2>&1)" || true
    if [ "$MODE" = "check" ]; then
      classify_dryrun "ec2:CreateSecurityGroup" "$OUT" || true
    else
      # $OUT을 JS 템플릿 리터럴로 직접 셸 치환하지 않고 파일에 써서 읽는다 — AWS 응답에 백틱·
      # 이스케이프 안 된 개행 등이 섞이면 셸 치환 방식은 깨지기 쉽다(실제로 create-key-pair에서
      # 이 문제로 실패한 적이 있음).
      printf '%s' "$OUT" > "$TMP_DIR/create-sg-out.json"
      SG_ID="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/create-sg-out.json','utf8')).GroupId)" 2>/dev/null || true)"
      [ -n "$SG_ID" ] || { echo "보안 그룹 생성 응답에서 GroupId를 못 읽었습니다: $OUT" >&2; exit 1; }
      aws_cmd ec2 create-tags --resources "$SG_ID" --tags "Key=Project,Value=$EXPECT_TAG_PROJECT" "Key=Environment,Value=$EXPECT_TAG_ENV" "Key=Name,Value=$SG_NAME"
      state_set sgId "\"$SG_ID\""
      echo "    생성됨: $SG_ID"
    fi
  fi
fi
if [ "$MODE" = "create" ] && [ -n "$SG_ID" ]; then
  aws_cmd ec2 describe-security-groups --group-ids "$SG_ID" --output json > "$TMP_DIR/sg-detail.json"
  add_rule_if_missing() {
    local port="$1" cidr="$2"
    local has
    has="$(node -e "
      const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/sg-detail.json','utf8')).SecurityGroups[0];
      const found=(d.IpPermissions||[]).some(p=>p.FromPort===$port && (p.IpRanges||[]).some(r=>r.CidrIp==='$cidr'));
      console.log(found?'yes':'no');
    ")"
    if [ "$has" = "no" ]; then
      aws_cmd ec2 authorize-security-group-ingress --group-id "$SG_ID" \
        --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$cidr}]"
      echo "    인그레스 추가: tcp/$port from $cidr"
    fi
  }
  add_rule_if_missing 80 "0.0.0.0/0"
  add_rule_if_missing 443 "0.0.0.0/0"
  add_rule_if_missing 22 "$ADMIN_SSH_CIDR"
  # 방어적 확인: 5432/3000이 실수로라도 열려 있으면 여기서 즉시 중단
  UNSAFE="$(node -e "
    const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/sg-detail.json','utf8')).SecurityGroups[0];
    const bad=(d.IpPermissions||[]).some(p=>p.FromPort===5432||p.FromPort===3000);
    console.log(bad?'yes':'no');
  ")"
  [ "$UNSAFE" = "no" ] || { echo "보안 그룹에 5432/3000 인바운드 규칙이 이미 있습니다 — 안전하지 않아 중단합니다." >&2; exit 1; }
fi

echo "[7/9] 키 페어($KEY_NAME) 확인/생성 중..."
KEY_STATE="$(state_get keyPairCreated)"
# 프로젝트 디렉터리 밖 ~/.ssh에 보관한다(실수로 git에 들어가거나 저장소를 통째로 공유할 때 같이
# 딸려나가는 사고를 피하기 위함). 자체 테스트에서는 LOCAL_KEY_FILE_OVERRIDE로 임시 경로를 써서
# 실제 ~/.ssh를 절대 건드리지 않는다.
LOCAL_KEY_FILE="${LOCAL_KEY_FILE_OVERRIDE:-$HOME/.ssh/$KEY_NAME.pem}"
mkdir -p "$(dirname "$LOCAL_KEY_FILE")"
chmod 700 "$(dirname "$LOCAL_KEY_FILE")" 2>/dev/null || true
if [ "$KEY_STATE" = "true" ]; then
  aws_cmd ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>"$TMP_DIR/kp.err" || {
    echo "상태 파일은 키 페어가 있다고 기록돼 있지만 AWS에서 확인되지 않습니다 — 중단합니다." >&2; exit 1; }
  echo "    기존 키 페어 확인됨(AWS에 존재)"
else
  aws_cmd ec2 describe-key-pairs --filters "Name=key-name,Values=$KEY_NAME" --output json > "$TMP_DIR/kps.json"
  KP_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/kps.json','utf8')).KeyPairs.length)")"
  if [ "$KP_COUNT" -ge 1 ]; then
    if [ -f "$LOCAL_KEY_FILE" ]; then
      state_set keyPairCreated "true"
      echo "    AWS에 이미 있고 로컬 프라이빗 키도 있음 — 재사용"
    else
      echo "AWS에 \"$KEY_NAME\" 키 페어가 이미 있지만 이 로컬에는 프라이빗 키 파일($LOCAL_KEY_FILE)이" \
           "없습니다. AWS는 프라이빗 키를 다시 내려주지 않으므로, 그 키를 이미 안전하게 보관 중이면" \
           "$LOCAL_KEY_FILE 에 직접 복사해 두고 재실행하거나, 잃어버렸다면 AWS 콘솔/CLI에서 그 키" \
           "페어를 지운 뒤(주의: 그 키로 접속하던 기존 서버가 있다면 먼저 확인) 재실행하세요 —" \
           "이 스크립트가 임의로 새 키를 만들거나 지우지 않습니다." >&2
      exit 1
    fi
  else
    if [ "$MODE" = "check" ]; then
      OUT="$(aws_cmd ec2 create-key-pair --dry-run --key-name "$KEY_NAME" --output json 2>&1)" || true
      classify_dryrun "ec2:CreateKeyPair" "$OUT" || true
    else
      # KeyMaterial(PEM, 여러 줄)은 JSON.parse로 다시 파싱하지 않고 --query/--output text로 직접
      # 받아 파일에 쓴다 — PEM처럼 긴 멀티라인 문자열은 `--output json`을 셸로 거쳐 JS 템플릿
      # 리터럴에 치환하는 방식과 상성이 나쁘다(실제로 여기서 "Bad control character" 파싱 실패를
      # 한 번 겪었다). --query text 경로는 그 문제 자체가 없다.
      if ! aws_cmd ec2 create-key-pair --key-name "$KEY_NAME" \
          --query 'KeyMaterial' --output text > "$LOCAL_KEY_FILE" 2>"$TMP_DIR/create-key.err"; then
        rm -f "$LOCAL_KEY_FILE"
        echo "키 페어 생성 실패:" >&2; cat "$TMP_DIR/create-key.err" >&2; exit 1
      fi
      chmod 400 "$LOCAL_KEY_FILE"
      if ! grep -q "BEGIN.*PRIVATE KEY" "$LOCAL_KEY_FILE"; then
        echo "키 페어는 생성됐지만 저장된 파일이 PEM 형식으로 보이지 않습니다 — 확인 필요: $LOCAL_KEY_FILE" >&2
        echo "AWS에는 이미 \"$KEY_NAME\" 이름으로 키 페어가 만들어졌으니(프라이빗 키는 재발급 불가)," \
             "필요하면 콘솔/CLI에서 지우고 재시도하세요." >&2
        exit 1
      fi
      state_set keyPairCreated "true"
      echo "    생성됨 — 프라이빗 키 저장: $LOCAL_KEY_FILE (0400, git에 커밋되지 않음)"
    fi
  fi
fi

echo "[8/9] Elastic IP·데이터 볼륨 확인/생성 중..."
EIP_ALLOC_ID="$(state_get eipAllocationId)"
if [ -z "$EIP_ALLOC_ID" ] && [ "$MODE" = "create" ]; then
  # 단일 스칼라 필드만 필요한 경우는 --query/--output text로 직접 받는다(JSON.parse+셸 치환
  # 방식보다 견고함 — create-key-pair에서 겪은 파싱 실패 참고).
  EIP_ALLOC_ID="$(aws_cmd ec2 allocate-address --domain vpc --query AllocationId --output text 2>"$TMP_DIR/eip.err")" || true
  [ -n "$EIP_ALLOC_ID" ] || { echo "EIP 할당 실패:" >&2; cat "$TMP_DIR/eip.err" >&2; exit 1; }
  aws_cmd ec2 create-tags --resources "$EIP_ALLOC_ID" --tags "Key=Project,Value=$EXPECT_TAG_PROJECT" "Key=Environment,Value=$EXPECT_TAG_ENV"
  state_set eipAllocationId "\"$EIP_ALLOC_ID\""
  echo "    EIP 할당됨: $EIP_ALLOC_ID"
elif [ "$MODE" = "check" ] && [ -z "$EIP_ALLOC_ID" ]; then
  OUT="$(aws_cmd ec2 allocate-address --dry-run --domain vpc --output json 2>&1)" || true
  classify_dryrun "ec2:AllocateAddress" "$OUT" || true
fi

# 데이터 볼륨 — 상태 파일에 한 번 기록되면 절대 다시 만들지 않는다(재실행 시 새 빈 볼륨이 되는 것을 방지)
DATA_VOLUME_ID="$(state_get dataVolumeId)"
if [ -n "$DATA_VOLUME_ID" ]; then
  aws_cmd ec2 describe-volumes --volume-ids "$DATA_VOLUME_ID" --output json > "$TMP_DIR/vol.json" 2>"$TMP_DIR/vol.err" || {
    echo "상태 파일의 데이터 볼륨($DATA_VOLUME_ID)을 AWS에서 확인할 수 없습니다 — 데이터가 있는" \
         "볼륨일 수 있으므로 자동으로 새로 만들지 않고 중단합니다. 직접 확인하세요." >&2
    exit 1
  }
  echo "    기존 데이터 볼륨 재사용: $DATA_VOLUME_ID (재생성하지 않음)"
elif [ -n "$(state_get pendingDataVolumeCreateAt)" ]; then
  cat >&2 <<EOF
이전 실행이 데이터 볼륨 생성 요청 뒤 결과를 확인 못 한 채 끝났습니다. 데이터 볼륨은 절대
자동으로 다시 만들지 않습니다(중복 생성 시 어느 쪽에 실제 DB 데이터가 들어가는지 헷갈릴 위험).
1) aws ec2 describe-volumes --filters Name=tag:Name,Values=$INSTANCE_NAME-data --profile $PROFILE --region $REGION
   로 실제로 만들어졌는지 확인
2) 있다면 그 VolumeId를 $STATE_FILE 의 "dataVolumeId"에 직접 채워 넣기
3) 없다면 "pendingDataVolumeCreateAt" 항목을 지우고 재실행
EOF
  exit 1
elif [ "$MODE" = "create" ]; then
  AZ="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/subnets.json','utf8')).Subnets[0].AvailabilityZone)")"
  state_set pendingDataVolumeCreateAt "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  DATA_VOLUME_ID="$(aws_cmd ec2 create-volume --availability-zone "$AZ" --size "$DATA_VOLUME_SIZE_GB" \
    --volume-type gp3 --encrypted --query VolumeId --output text 2>"$TMP_DIR/vol-create.err")" || true
  [ -n "$DATA_VOLUME_ID" ] || { echo "데이터 볼륨 생성 실패:" >&2; cat "$TMP_DIR/vol-create.err" >&2; exit 1; }
  aws_cmd ec2 create-tags --resources "$DATA_VOLUME_ID" \
    --tags "Key=Project,Value=$EXPECT_TAG_PROJECT" "Key=Environment,Value=$EXPECT_TAG_ENV" "Key=Role,Value=postgres-data" "Key=Name,Value=$INSTANCE_NAME-data"
  state_set dataVolumeId "\"$DATA_VOLUME_ID\""
  state_del pendingDataVolumeCreateAt
  echo "    생성됨: $DATA_VOLUME_ID (크기 ${DATA_VOLUME_SIZE_GB}GiB, DeleteOnTermination 아님 — attach 시 별도 지정)"
elif [ "$MODE" = "check" ]; then
  AZ="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/subnets.json','utf8')).Subnets[0].AvailabilityZone)")"
  OUT="$(aws_cmd ec2 create-volume --dry-run --availability-zone "$AZ" --size "$DATA_VOLUME_SIZE_GB" --volume-type gp3 --encrypted --output json 2>&1)" || true
  classify_dryrun "ec2:CreateVolume" "$OUT" || true
fi

echo "[9/9] EC2 인스턴스 확인/생성 중..."

CONNECTIONS_INCOMPLETE="no"   # 데이터 볼륨/EIP 연결이 제한 시간 내 attached로 확인 안 되면 yes

# 볼륨/EIP 연결을 기다린다: 연결 명령이 "성공"했다는 응답만으로 연결이 끝났다고 보지 않고,
# 다시 조회해서 실제로 attached 상태가 됐는지 확인한다. attaching(진행 중)이면 잠시 기다렸다가
# 재조회하고, 제한 시간 안에 attached로 확인되지 않으면 CONNECTIONS_INCOMPLETE=yes로만 표시하고
# (스크립트를 죽이지 않음 — 이미 만든 자원은 그대로 둠) 최종 요약에서 미완료로 보고한다.
wait_for_volume_attached() {  # $1=instance id
  local iid="$1" attempts="${VOLUME_ATTACH_WAIT_ATTEMPTS:-12}" interval="${VOLUME_ATTACH_WAIT_INTERVAL:-5}" i=1
  while [ "$i" -le "$attempts" ]; do
    aws_cmd ec2 describe-volumes --volume-ids "$DATA_VOLUME_ID" --output json > "$TMP_DIR/vol-wait.json"
    local state
    state="$(node -e "
      const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/vol-wait.json','utf8')).Volumes[0];
      const a=(d.Attachments||[]).find(x=>x.InstanceId==='$iid');
      console.log(a?a.State:'');
    ")"
    if [ "$state" = "attached" ]; then return 0; fi
    if [ "$state" != "attaching" ] && [ -n "$state" ]; then return 1; fi  # 예상 못 한 상태면 더 기다리지 않음
    i=$((i + 1))
    [ "$i" -le "$attempts" ] && sleep "$interval"
  done
  return 1
}

wait_for_eip_associated() {  # $1=instance id
  local iid="$1" attempts="${EIP_ASSOC_WAIT_ATTEMPTS:-6}" interval="${EIP_ASSOC_WAIT_INTERVAL:-3}" i=1
  while [ "$i" -le "$attempts" ]; do
    aws_cmd ec2 describe-addresses --allocation-ids "$EIP_ALLOC_ID" --output json > "$TMP_DIR/eip-wait.json"
    local assoc
    assoc="$(node -e "
      const d=(JSON.parse(require('fs').readFileSync('$TMP_DIR/eip-wait.json','utf8')).Addresses||[])[0]||{};
      console.log(d.InstanceId||'');
    ")"
    [ "$assoc" = "$iid" ] && return 0
    i=$((i + 1))
    [ "$i" -le "$attempts" ] && sleep "$interval"
  done
  return 1
}

# 데이터 볼륨·EIP가 이 인스턴스에 실제로 연결돼 있는지 확인하고, 빠져 있으면 이어서 연결한다.
# 다른 인스턴스에 이미 연결돼 있으면 임의로 옮기지 않고 중단한다. 연결 명령 성공은 "요청이
# 접수됐다"는 뜻일 뿐이라, 반드시 다시 조회해 attached/연결됨 상태를 확인한 뒤에만 완료로 본다.
verify_instance_connections() {
  local iid="$1"
  if [ -n "$DATA_VOLUME_ID" ]; then
    aws_cmd ec2 describe-volumes --volume-ids "$DATA_VOLUME_ID" --output json > "$TMP_DIR/vol-check.json"
    local vol_attached_to vol_state
    vol_attached_to="$(node -e "
      const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/vol-check.json','utf8')).Volumes[0];
      const a=(d.Attachments||[]).find(x=>x.State==='attached'||x.State==='attaching');
      console.log(a?a.InstanceId:'');
    ")"
    if [ -z "$vol_attached_to" ]; then
      echo "    데이터 볼륨($DATA_VOLUME_ID)이 어디에도 연결돼 있지 않음 — $iid 에 연결 요청"
      aws_cmd ec2 attach-volume --volume-id "$DATA_VOLUME_ID" --instance-id "$iid" --device /dev/sdf
      if wait_for_volume_attached "$iid"; then
        echo "    데이터 볼륨 연결 완료 확인됨(attached)"
      else
        echo "    *** 미완료: 데이터 볼륨이 제한 시간 안에 attached 상태로 확인되지 않음(계속 attaching이거나 응답 없음) ***" >&2
        CONNECTIONS_INCOMPLETE="yes"
      fi
    elif [ "$vol_attached_to" = "$iid" ]; then
      if wait_for_volume_attached "$iid"; then
        echo "    데이터 볼륨 연결 확인됨(이 인스턴스, attached)"
      else
        echo "    *** 미완료: 데이터 볼륨이 이 인스턴스에 연결 중(attaching)이나 제한 시간 안에 attached로 확인되지 않음 ***" >&2
        CONNECTIONS_INCOMPLETE="yes"
      fi
    else
      echo "데이터 볼륨($DATA_VOLUME_ID)이 다른 인스턴스($vol_attached_to)에 이미 연결돼 있습니다 —" \
           "임의로 옮기지 않고 중단합니다. 직접 확인하세요." >&2
      exit 1
    fi
  fi
  if [ -n "$EIP_ALLOC_ID" ]; then
    aws_cmd ec2 describe-addresses --allocation-ids "$EIP_ALLOC_ID" --output json > "$TMP_DIR/eip-check.json"
    local eip_attached_to
    eip_attached_to="$(node -e "
      const d=(JSON.parse(require('fs').readFileSync('$TMP_DIR/eip-check.json','utf8')).Addresses||[])[0]||{};
      console.log(d.InstanceId||'');
    ")"
    if [ -z "$eip_attached_to" ]; then
      echo "    EIP($EIP_ALLOC_ID)가 어디에도 연결돼 있지 않음 — $iid 에 연결 요청"
      aws_cmd ec2 associate-address --instance-id "$iid" --allocation-id "$EIP_ALLOC_ID"
      if wait_for_eip_associated "$iid"; then
        echo "    EIP 연결 완료 확인됨"
      else
        echo "    *** 미완료: EIP 연결이 제한 시간 안에 확인되지 않음 ***" >&2
        CONNECTIONS_INCOMPLETE="yes"
      fi
    elif [ "$eip_attached_to" = "$iid" ]; then
      echo "    EIP 연결 확인됨(이 인스턴스)"
    else
      echo "EIP($EIP_ALLOC_ID)가 다른 인스턴스($eip_attached_to)에 이미 연결돼 있습니다 —" \
           "임의로 옮기지 않고 중단합니다. 직접 확인하세요." >&2
      exit 1
    fi
  fi
}

# ── client-token 기반 생성 요청 — 응답을 못 받아도, 나중에 같은 token+파라미터로 재시도하면
# AWS가 중복 생성 대신 같은 인스턴스를 돌려준다(멱등성 보장은 우리 쪽 태그 검색이 아니라
# AWS API 자체가 해 준다). ──
generate_client_token() { node -e "console.log(require('crypto').randomUUID())"; }

save_pending_instance_request() {  # $1=token $2=iam_profile_arg $3=bdm $4=tag_spec
  state_set pendingInstanceCreateAt "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  state_set pendingInstanceCreateToken "\"$1\""
  local params_json
  params_json="$(node -e '
    const [amiId, instanceType, keyName, sgId, subnetId, iamProfileArg, bdm, tagSpec] = process.argv.slice(1);
    console.log(JSON.stringify({amiId, instanceType, keyName, sgId, subnetId, iamProfileArg, bdm, tagSpec}));
  ' "$AMI_ID" "$INSTANCE_TYPE" "$KEY_NAME" "$SG_ID" "$SUBNET_ID" "$2" "$3" "$4")"
  state_set pendingInstanceParams "$params_json"
}

load_pending_instance_params() {  # 상태 파일에 저장된 값으로 AMI_ID 등 변수를 되채운다(재계산하지 않음)
  local raw; raw="$(state_get pendingInstanceParams)"
  [ -n "$raw" ] || { echo "저장된 생성 파라미터(pendingInstanceParams)가 없어 재시도할 수 없습니다 — 중단합니다." >&2; exit 1; }
  AMI_ID="$(node -e "console.log(JSON.parse(process.argv[1]).amiId)" "$raw")"
  INSTANCE_TYPE="$(node -e "console.log(JSON.parse(process.argv[1]).instanceType)" "$raw")"
  KEY_NAME="$(node -e "console.log(JSON.parse(process.argv[1]).keyName)" "$raw")"
  SG_ID="$(node -e "console.log(JSON.parse(process.argv[1]).sgId)" "$raw")"
  SUBNET_ID="$(node -e "console.log(JSON.parse(process.argv[1]).subnetId)" "$raw")"
  IAM_PROFILE_ARG="$(node -e "console.log(JSON.parse(process.argv[1]).iamProfileArg)" "$raw")"
  BDM="$(node -e "console.log(JSON.parse(process.argv[1]).bdm)" "$raw")"
  TAG_SPEC="$(node -e "console.log(JSON.parse(process.argv[1]).tagSpec)" "$raw")"
}

attempt_run_instances() {  # AMI_ID/INSTANCE_TYPE/.../TAG_SPEC/CLIENT_TOKEN이 이미 설정돼 있어야 함
  INSTANCE_ID="$(aws_cmd ec2 run-instances --client-token "$CLIENT_TOKEN" \
    --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --security-group-ids "$SG_ID" --subnet-id "$SUBNET_ID" \
    $IAM_PROFILE_ARG \
    --block-device-mappings "$BDM" \
    --tag-specifications "$TAG_SPEC" \
    --query 'Instances[0].InstanceId' --output text 2>"$TMP_DIR/run-instances.err")" || true
  if [ -z "$INSTANCE_ID" ]; then
    echo "인스턴스 생성 요청에 대한 응답을 받지 못했습니다(상태 기록은 보존됨 — client-token=$CLIENT_TOKEN):" >&2
    cat "$TMP_DIR/run-instances.err" >&2
    exit 1
  fi
  state_set instanceId "\"$INSTANCE_ID\""
  state_del pendingInstanceCreateAt
  state_del pendingInstanceCreateToken
  state_del pendingInstanceParams
  echo "    생성됨(client-token=${CLIENT_TOKEN}로 확인): $INSTANCE_ID"
  aws_cmd ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  verify_instance_connections "$INSTANCE_ID"
}

INSTANCE_ID="$(state_get instanceId)"
ALREADY_PROCESSED="no"
if [ -z "$INSTANCE_ID" ] && [ -n "$(state_get pendingInstanceCreateAt)" ]; then
  echo "    이전 실행이 인스턴스 생성 요청 뒤 응답을 확인하지 못한 채 끝났습니다 — AWS 조회 반영 지연을" \
       "감안해 간격을 늘려가며 재조회합니다(재호출은 하지 않습니다)..."
  ATTEMPTS="${INSTANCE_PENDING_CHECK_ATTEMPTS:-5}"
  INTERVAL="${INSTANCE_PENDING_CHECK_INTERVAL:-5}"
  FOUND_COUNT=""
  attempt=1
  while [ "$attempt" -le "$ATTEMPTS" ]; do
    if [ "$attempt" -gt 1 ]; then
      echo "    ${INTERVAL}초 대기 후 재조회(${attempt}/${ATTEMPTS})..."
      sleep "$INTERVAL"
      INTERVAL=$((INTERVAL * 2))
    fi
    if aws_cmd ec2 describe-instances \
        --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=tag:Project,Values=$EXPECT_TAG_PROJECT" \
        "Name=tag:Environment,Values=$EXPECT_TAG_ENV" \
        "Name=instance-state-name,Values=pending,running,stopping,stopped" \
        --output json > "$TMP_DIR/pending-inst.json" 2>"$TMP_DIR/pending-inst.err"; then
      FOUND_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/pending-inst.json','utf8')).Reservations.flatMap(r=>r.Instances).length)")"
      [ "$FOUND_COUNT" != "0" ] && break
    else
      echo "    ${attempt}번째 조회 자체가 실패(권한/통신 오류) — 계속 재시도합니다." >&2
    fi
    attempt=$((attempt + 1))
  done

  if [ "$FOUND_COUNT" = "1" ]; then
    INSTANCE_ID="$(node -e "
      const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/pending-inst.json','utf8'));
      console.log(d.Reservations.flatMap(r=>r.Instances)[0].InstanceId);
    ")"
    state_set instanceId "\"$INSTANCE_ID\""
    state_del pendingInstanceCreateAt
    state_del pendingInstanceCreateToken
    state_del pendingInstanceParams
    echo "    확인됨 — 이전 요청이 실제로는 성공했습니다: $INSTANCE_ID (상태 파일에 반영, 재생성하지 않음)"
  elif [ -n "$FOUND_COUNT" ] && [ "$FOUND_COUNT" -gt 1 ]; then
    echo "이름이 \"$INSTANCE_NAME\"인 인스턴스가 ${FOUND_COUNT}개 발견돼 그때 만든 것이 어느 것인지" \
         "확정할 수 없습니다 — 중단합니다. 콘솔에서 직접 확인한 뒤 필요 없는 것을 정리하거나" \
         "$STATE_FILE 의 instanceId를 직접 채우고 재실행하세요." >&2
    exit 1
  else
    # ${ATTEMPTS}회(간격을 늘려가며) 재조회해도 0건 — 이것을 "미생성 확정"으로 간주하지 않는다
    # (AWS 조회 반영 지연일 수 있음). 상태 기록은 그대로 두고 중단한다. 사람이 직접 확인한
    # 뒤에만, 저장된 것과 동일한 client-token으로 명시적 재시도(RETRY_INSTANCE_CREATE=yes)를 한다.
    if [ "$MODE" = "create" ] && [ "${RETRY_INSTANCE_CREATE:-no}" = "yes" ]; then
      echo "    ${ATTEMPTS}회 재조회에도 확인되지 않았지만 RETRY_INSTANCE_CREATE=yes이므로 저장된" \
           "client-token·파라미터로 재시도합니다(이미 만들어졌다면 AWS가 같은 인스턴스를 반환합니다)."
      CLIENT_TOKEN="$(state_get pendingInstanceCreateToken)"
      [ -n "$CLIENT_TOKEN" ] || { echo "저장된 client-token이 없어 재시도할 수 없습니다 — 중단합니다." >&2; exit 1; }
      load_pending_instance_params
      attempt_run_instances
      ALREADY_PROCESSED="yes"
    else
      cat >&2 <<EOF
${ATTEMPTS}회(간격을 늘려가며) 재조회했지만 확인되지 않았습니다 — "미생성 확정"으로 간주하지
않고, 재호출도 하지 않습니다(중복 생성 위험). 상태 파일은 그대로 보존합니다.
  1) AWS 콘솔/CLI에서 태그 Name=$INSTANCE_NAME 인스턴스가 실제로 있는지 직접 확인하세요.
  2) 있다면 그 InstanceId를 $STATE_FILE 의 "instanceId"에 채워 넣으세요.
  3) 없다는 것을 확인했다면(그리고 MODE=create라면) RETRY_INSTANCE_CREATE=yes로 재실행하세요 —
     저장된 것과 동일한 client-token·파라미터로 안전하게 재시도합니다.
EOF
      exit 1
    fi
  fi
fi

if [ "$ALREADY_PROCESSED" = "yes" ]; then
  : # attempt_run_instances가 wait+verify까지 이미 처리함 — 아래 재사용 블록을 다시 타지 않는다
elif [ -n "$INSTANCE_ID" ]; then
  aws_cmd ec2 describe-instances --instance-ids "$INSTANCE_ID" --output json > "$TMP_DIR/inst.json" 2>"$TMP_DIR/inst.err" || {
    echo "상태 파일의 인스턴스($INSTANCE_ID)를 확인할 수 없습니다 — 중단합니다." >&2; exit 1; }
  STATE_NAME="$(node -e "
    const d=JSON.parse(require('fs').readFileSync('$TMP_DIR/inst.json','utf8'));
    console.log(d.Reservations[0].Instances[0].State.Name);
  ")"
  echo "    기존 인스턴스 재사용: $INSTANCE_ID (상태: $STATE_NAME)"
  # SKIP_IAM_AND_BACKUP 없이 재실행됐고(=admin이 역할을 이미 만든 뒤) 이 인스턴스가 처음엔
  # 프로파일 없이 만들어졌다면, 지금이라도 같은 인스턴스에 붙여준다(재생성하지 않음).
  if [ "$MODE" = "create" ] && [ "$SKIP_IAM_AND_BACKUP" != "yes" ]; then
    aws_cmd ec2 describe-iam-instance-profile-associations \
      --filters "Name=instance-id,Values=$INSTANCE_ID" "Name=state,Values=associating,associated" \
      --output json > "$TMP_DIR/iam-assoc.json"
    ASSOC_COUNT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$TMP_DIR/iam-assoc.json','utf8')).IamInstanceProfileAssociations.length)")"
    if [ "$ASSOC_COUNT" -eq 0 ]; then
      echo "    인스턴스 프로파일이 아직 연결돼 있지 않음 — 지금 연결: $INSTANCE_PROFILE_NAME"
      aws_cmd ec2 associate-iam-instance-profile --instance-id "$INSTANCE_ID" \
        --iam-instance-profile "Name=$INSTANCE_PROFILE_NAME"
    else
      echo "    인스턴스 프로파일 이미 연결돼 있음(건너뜀)"
    fi
  fi
  if [ "$MODE" = "create" ]; then
    verify_instance_connections "$INSTANCE_ID"
  fi
elif [ "$MODE" = "create" ]; then
  if [ -z "$SG_ID" ] || [ -z "$DATA_VOLUME_ID" ]; then
    echo "보안 그룹/데이터 볼륨 준비가 끝나지 않아 인스턴스를 만들 수 없습니다 — 위 단계를 확인하세요." >&2
    exit 1
  fi
  BDM="[{\"DeviceName\":\"$ROOT_DEVICE_NAME\",\"Ebs\":{\"VolumeSize\":$ROOT_VOLUME_SIZE_GB,\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}}]"
  IAM_PROFILE_ARG=""
  [ "$SKIP_IAM_AND_BACKUP" = "yes" ] || IAM_PROFILE_ARG="--iam-instance-profile Name=$INSTANCE_PROFILE_NAME"
  TAG_SPEC="ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=Project,Value=$EXPECT_TAG_PROJECT},{Key=Environment,Value=$EXPECT_TAG_ENV}]"
  CLIENT_TOKEN="$(generate_client_token)"
  save_pending_instance_request "$CLIENT_TOKEN" "$IAM_PROFILE_ARG" "$BDM" "$TAG_SPEC"
  attempt_run_instances
elif [ "$MODE" = "check" ]; then
  OUT="$(aws_cmd ec2 run-instances --dry-run --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
    --subnet-id "$SUBNET_ID" --security-group-ids "$(aws_cmd ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=default" --query 'SecurityGroups[0].GroupId' --output text)" \
    --output json 2>&1)" || true
  classify_dryrun "ec2:RunInstances(인스턴스 프로파일 미포함 — PassRole은 별도 확인 필요)" "$OUT" || true
fi

echo
if [ "$MODE" = "check" ]; then
  echo "=== --check 완료: 자원을 만들거나 바꾸지 않았습니다 ==="
else
  # 데이터 볼륨·EIP 연결이 실제로 확인된 뒤에만 "완료"로 표시한다 — 연결 명령이 성공했다는
  # 것만으로 완료라고 하지 않는다.
  if [ "$CONNECTIONS_INCOMPLETE" = "yes" ]; then
    echo "=== 부분 완료(연결 확인 안 됨) ==="
  else
    echo "=== 완료 ==="
  fi
  echo "InstanceId=$INSTANCE_ID SecurityGroupId=$SG_ID DataVolumeId=$DATA_VOLUME_ID"
  if [ "$CONNECTIONS_INCOMPLETE" = "yes" ]; then
    echo "*** 미완료: 데이터 볼륨·EIP 중 하나 이상이 제한 시간 안에 연결 완료(attached/연결됨)로" \
         "확인되지 않았습니다 — 위 로그에서 어떤 자원인지 확인한 뒤 잠시 후 재실행하면 이어서" \
         "확인합니다(자원을 다시 만들지 않음). ***"
  fi
  if [ "$SKIP_IAM_AND_BACKUP" = "yes" ]; then
    echo "Bucket=(생성 안 함) IamInstanceProfile=(연결 안 함)"
    echo "*** 미완료: IAM 인스턴스 역할/프로파일 연결, S3 백업 버킷, PostgreSQL 논리 백업의 S3" \
         "자동 업로드 — admin이 역할·프로파일을 만든 뒤 SKIP_IAM_AND_BACKUP 없이 재실행하면" \
         "같은 인스턴스에 역할을 붙이고 버킷·백업을 이어서 준비합니다. ***"
  else
    echo "Bucket=$BUCKET_NAME IamInstanceProfile=$INSTANCE_PROFILE_NAME"
  fi
  if [ "$CONNECTIONS_INCOMPLETE" = "yes" ]; then
    exit 1  # 미완료면 종료코드도 0이 아니게(자동화가 "완료로 표시"와 구분해 감지할 수 있도록)
  fi
fi
