#!/bin/bash
# create-dev-server.sh를 실제 AWS를 부르지 않고 검증한다. 매 테스트마다 스크립트와 필요한
# params.json을 새 임시 디렉터리로 복사해 실행한다 — 그러면 상태 파일이 그 임시 디렉터리 안에만
# 생기고 실제 infra/ec2/state.local.json은 절대 건드리지 않는다.
set -uo pipefail  # -e는 안 씀 — 각 케이스의 실패 여부를 직접 판정해야 해서

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EC2_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 재시도·대기 루프의 실제 sleep 시간이 테스트를 느리게 만들지 않도록 기본값을 짧게 오버라이드
# 한다(로직 검증이 목적이지 실제 지연 시간 검증이 목적이 아님 — 몇 초 간격인지는 스크립트
# 소스/기본값으로 확인, 여기서는 회귀 동작만 빠르게 확인).
export INSTANCE_PENDING_CHECK_ATTEMPTS=2
export INSTANCE_PENDING_CHECK_INTERVAL=0
export VOLUME_ATTACH_WAIT_ATTEMPTS=2
export VOLUME_ATTACH_WAIT_INTERVAL=0
export EIP_ASSOC_WAIT_ATTEMPTS=2
export EIP_ASSOC_WAIT_INTERVAL=0
FAKE_AWS_DIR="$SCRIPT_DIR/bin"
mkdir -p "$FAKE_AWS_DIR"
cp "$SCRIPT_DIR/fake-aws" "$FAKE_AWS_DIR/aws"
chmod +x "$FAKE_AWS_DIR/aws"

PASS=0
FAIL=0

# create-dev-server.sh가 실행 중 실제로 파일로 읽는 것은 이 3개 버킷 params.json뿐이다
# (instance-role-*.json/passrole-*.json/dlm-*.json은 안내 메시지에 경로 문자열로만 등장하고
# 실제로 열어 읽지는 않는다). *.json 글롭으로 통째로 복사하지 않고 이 목록만 명시적으로
# 복사한다 — 그래야 실제 state.local.json(진짜 AWS 자원 ID 포함)이나 실제 개인 키(.pem)가
# 애初부터 테스트 디렉터리에 들어올 방법 자체가 없다(지우는 방식에 기대지 않음).
REQUIRED_PARAM_FILES=(
  bucket-public-access-block.params.json
  bucket-encryption.params.json
  bucket-lifecycle.params.json
)

setup_case() {
  local case_dir
  case_dir="$(mktemp -d)"
  local f
  for f in "${REQUIRED_PARAM_FILES[@]}"; do
    cp "$EC2_DIR/$f" "$case_dir/"
  done
  cp "$EC2_DIR/create-dev-server.sh" "$case_dir/"
  chmod +x "$case_dir/create-dev-server.sh"
  # 테스트 전용 상태 파일·가짜 키만 이 안에서 새로 만든다(실제 것을 복사해오지 않음) — 상태
  # 파일은 run_case가 state_json을 받아 여기 만들고, 키 파일은 create-dev-server.sh가
  # LOCAL_KEY_FILE_OVERRIDE 경로에 스스로 만든다(가짜 aws가 내려주는 가짜 PEM 텍스트).
  echo "$case_dir"
}

run_case() {
  local name="$1" mode="$2" ssh_cidr="$3" state_json="$4" skip_iam="${5:-no}"; shift 4; [ $# -ge 1 ] && shift
  local case_dir call_log out rc
  case_dir="$(setup_case)"
  call_log="$case_dir/calls.log"
  [ -n "$state_json" ] && printf '%s' "$state_json" > "$case_dir/state.local.json"
  local checkflag=""
  [ "$mode" = "check" ] && checkflag="--check"
  # bash 3.2(macOS 기본)의 "빈 배열 + set -u = unbound variable" 버그를 피하려고 배열 대신
  # 문자열로 두고 따옴표 없이 확장한다(값은 ""나 "--check"뿐이라 단어분리 문제 없음).
  # LOCAL_KEY_FILE_OVERRIDE로 키 파일도 이 임시 디렉터리 안에만 쓰게 한다 — 실제 ~/.ssh를
  # 절대 건드리지 않기 위함(기본 동작은 ~/.ssh/<키이름>.pem에 저장하도록 바뀌었음).
  out="$(PATH="$FAKE_AWS_DIR:$PATH" FAKE_AWS_MODE="${FAKE_AWS_MODE:-happy}" FAKE_AWS_CALL_LOG="$call_log" \
    ADMIN_SSH_CIDR="$ssh_cidr" SKIP_IAM_AND_BACKUP="$skip_iam" \
    LOCAL_KEY_FILE_OVERRIDE="$case_dir/test-key.pem" \
    AWS_PROFILE_OVERRIDE=tunibridge AWS_REGION_OVERRIDE=ap-northeast-2 \
    "$case_dir/create-dev-server.sh" $checkflag 2>&1)"
  rc=$?
  CASE_OUT="$out"
  CASE_RC=$rc
  CASE_LOG="$([ -f "$call_log" ] && cat "$call_log" || echo "")"
  CASE_STATE="$([ -f "$case_dir/state.local.json" ] && cat "$case_dir/state.local.json" || echo "")"
  rm -rf "$case_dir"
}

check() {
  local desc="$1" ok="$2"
  if [ "$ok" = "yes" ]; then PASS=$((PASS+1)); echo "  [PASS] $desc";
  else FAIL=$((FAIL+1)); echo "  [FAIL] $desc"; echo "$CASE_OUT" | sed 's/^/         /'; fi
}

echo "1) --check 모드 정상 경로: 자원 생성 없이 끝까지 진행되고 DryRunOperation을 보고해야 한다"
FAKE_AWS_MODE=happy run_case c1 check "1.2.3.4/32" ""
[ "$CASE_RC" -eq 0 ] && [[ "$CASE_OUT" == *"--check 완료"* ]] && ok=yes || ok=no
check "정상 종료 + 완료 메시지" "$ok"
[[ "$CASE_OUT" == *"DryRunOperation"* ]] && ok=yes || ok=no
check "DryRunOperation 결과가 최소 1건 이상 보고됨" "$ok"
[[ "$CASE_LOG" != *"create-bucket"* ]] && ok=yes || ok=no
check "--check 모드에서 s3:CreateBucket(DryRun 미지원)은 아예 호출하지 않음" "$ok"

echo "2) IAM 역할/프로파일이 없으면 admin 요청 안내와 함께 중단해야 한다"
FAKE_AWS_MODE=missing_iam_role run_case c2 check "1.2.3.4/32" ""
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"admin에게"* ]] && ok=yes || ok=no
check "0이 아닌 종료코드 + admin 요청 안내 출력" "$ok"

echo "3) 기본 VPC가 2개 이상이면 어떤 것도 임의로 고르지 않고 중단해야 한다"
FAKE_AWS_MODE=ambiguous_vpc run_case c3 check "1.2.3.4/32" ""
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"기본 VPC가 정확히 1개가 아닙니다"* ]] && ok=yes || ok=no
check "중단 + 명확한 이유 출력" "$ok"

echo "4) ADMIN_SSH_CIDR이 없으면 중단해야 한다(SSH 허용 IP 없이 진행하지 않음)"
FAKE_AWS_MODE=happy run_case c4 check "" ""
[ "$CASE_RC" -ne 0 ] && ok=yes || ok=no
check "ADMIN_SSH_CIDR 미설정 시 중단" "$ok"

echo "5) 상태 파일에 버킷이 준비됐다고 기록돼 있는데 실제로 head-bucket이 실패하면 중단해야 한다"
FAKE_AWS_MODE=bucket_state_mismatch run_case c5 check "1.2.3.4/32" '{"bucketReady":"true"}'
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"실제로 head-bucket이 실패"* ]] && ok=yes || ok=no
check "상태-실제 불일치 감지 + 중단" "$ok"

echo "6) create 모드에서 버킷명을 다른 계정이 이미 선점했으면(BucketAlreadyExists) 강행하지 않고 중단해야 한다"
FAKE_AWS_MODE=bucket_already_exists_elsewhere run_case c6 create "1.2.3.4/32" ""
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"다른 AWS 계정이 이미 이 버킷명을 선점"* ]] && ok=yes || ok=no
check "BucketAlreadyExists 감지 + 중단(강행하지 않음)" "$ok"

echo "7) 상태 파일에 데이터 볼륨 ID가 이미 있으면 재사용하고 절대 새로 만들지 않아야 한다(핵심 안전장치)"
FAKE_AWS_MODE=happy run_case c7 check "1.2.3.4/32" '{"dataVolumeId":"vol-existingfake"}'
[[ "$CASE_OUT" == *"기존 데이터 볼륨 재사용"* ]] && ok=yes || ok=no
check "재사용 메시지 출력" "$ok"
[[ "$CASE_LOG" != *"create-volume"* ]] && ok=yes || ok=no
check "ec2:CreateVolume이 단 한 번도 호출되지 않음" "$ok"

echo "8) 상태 파일의 데이터 볼륨을 AWS에서 확인할 수 없으면(삭제됨 등) 자동으로 새로 만들지 않고 중단해야 한다"
FAKE_AWS_MODE=data_volume_missing run_case c8 check "1.2.3.4/32" '{"dataVolumeId":"vol-goneFake"}'
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"자동으로 새로 만들지 않고 중단"* ]] && ok=yes || ok=no
check "확인 불가 시 자동 재생성하지 않고 중단" "$ok"

echo "9) SKIP_IAM_AND_BACKUP=yes면 IAM 역할이 없어도(get-role 자체를 호출하지 않고) 건너뛰고 진행해야 한다"
FAKE_AWS_MODE=missing_iam_role run_case c9 check "1.2.3.4/32" "" yes
[ "$CASE_RC" -eq 0 ] && [[ "$CASE_OUT" == *"[건너뜀]"* ]] && ok=yes || ok=no
check "IAM 미존재에도 성공 + [건너뜀] 표시" "$ok"
[[ "$CASE_LOG" != *"get-role"* ]] && ok=yes || ok=no
check "iam:GetRole을 아예 호출하지 않음" "$ok"
[[ "$CASE_OUT" == *"미완료"* ]] && ok=yes || ok=no
check "백업 미완료가 조용히 생략되지 않고 명시됨" "$ok"

echo "10) SKIP_IAM_AND_BACKUP=yes로 실제 생성 시 S3 버킷을 만들지 않고, 인스턴스 프로파일 없이 run-instances를 호출해야 한다"
FAKE_AWS_MODE=happy run_case c10 create "1.2.3.4/32" "" yes
[ "$CASE_RC" -eq 0 ] && ok=yes || ok=no
check "정상 종료" "$ok"
[[ "$CASE_LOG" != *"create-bucket"* ]] && ok=yes || ok=no
check "s3:CreateBucket을 호출하지 않음" "$ok"
[[ "$CASE_LOG" != *"iam-instance-profile"* ]] && ok=yes || ok=no
check "run-instances 호출에 --iam-instance-profile이 없음" "$ok"

PENDING_STATE='{"dataVolumeId":"vol-existingfake","eipAllocationId":"eipalloc-fake","pendingInstanceCreateAt":"2026-01-01T00:00:00Z"}'

echo "11) 인스턴스 생성 응답 유실(pending만 있고 instanceId 없음) 뒤 재실행 — 실제로 만들어져 있었으면 재호출하지 않고 그 인스턴스를 그대로 써야 한다"
FAKE_AWS_MODE=instance_pending_recovered run_case c11 create "1.2.3.4/32" "$PENDING_STATE" yes
[ "$CASE_RC" -eq 0 ] && [[ "$CASE_OUT" == *"i-recoveredfake"* ]] && ok=yes || ok=no
check "태그 검색으로 기존 인스턴스를 찾아 그대로 사용" "$ok"
[[ "$CASE_LOG" != *"run-instances"* ]] && ok=yes || ok=no
check "ec2:RunInstances를 다시 호출하지 않음(중복 생성 방지)" "$ok"

echo "12) 같은 pending 상황에서 재조회 결과가 계속 0건이면 — 미생성 확정으로 간주하지 않고, 재호출도 하지 않고, 상태를 보존한 채 중단해야 한다"
FAKE_AWS_MODE=instance_pending_none run_case c12 create "1.2.3.4/32" "$PENDING_STATE" yes
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *'"미생성 확정"으로 간주하지'* ]] && ok=yes || ok=no
check "0건이 계속돼도 미생성 확정으로 간주하지 않고 중단" "$ok"
[[ "$CASE_LOG" != *"run-instances"* ]] && ok=yes || ok=no
check "ec2:RunInstances를 재호출하지 않음(중복 생성 방지)" "$ok"
[[ "$CASE_STATE" == *"pendingInstanceCreateAt"* ]] && ok=yes || ok=no
check "pendingInstanceCreateAt 상태 기록이 지워지지 않고 보존됨" "$ok"

PENDING_STATE_WITH_TOKEN='{"dataVolumeId":"vol-existingfake","eipAllocationId":"eipalloc-fake","pendingInstanceCreateAt":"2026-01-01T00:00:00Z","pendingInstanceCreateToken":"token-abc-123","pendingInstanceParams":{"amiId":"ami-fake123","instanceType":"t4g.small","keyName":"deardarling-dev-ec2-key","sgId":"sg-newfake","subnetId":"subnet-fake1","iamProfileArg":"","bdm":"[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{}}]","tagSpec":"ResourceType=instance,Tags=[]"}}'

echo "12b) 재조회로도 확인 안 되고 RETRY_INSTANCE_CREATE=yes면 — 저장된 것과 동일한 client-token으로만 재시도해야 한다"
FAKE_AWS_MODE=instance_pending_none RETRY_INSTANCE_CREATE=yes run_case c12b create "1.2.3.4/32" "$PENDING_STATE_WITH_TOKEN" yes
[ "$CASE_RC" -eq 0 ] && ok=yes || ok=no
check "명시적 재시도 시 정상 종료" "$ok"
[[ "$CASE_LOG" == *"run-instances"* ]] && ok=yes || ok=no
check "이번엔 실제로 재시도(run-instances)함" "$ok"
[[ "$CASE_LOG" == *"--client-token token-abc-123"* ]] && ok=yes || ok=no
check "새 토큰을 발급하지 않고 저장된 client-token(token-abc-123)을 그대로 재사용함" "$ok"

echo "13) 같은 pending 상황에서 태그가 일치하는 인스턴스가 여러 개면(확정 불가) 중단해야 한다"
FAKE_AWS_MODE=instance_pending_ambiguous run_case c13 create "1.2.3.4/32" "$PENDING_STATE" yes
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"확정할 수 없습니다"* ]] && ok=yes || ok=no
check "확정 불가 시 중단 + 이유 표시" "$ok"
[[ "$CASE_LOG" != *"run-instances"* ]] && ok=yes || ok=no
check "확정 안 된 채로 재호출하지 않음" "$ok"

FULL_STATE='{"instanceId":"i-existingfake","dataVolumeId":"vol-existingfake","eipAllocationId":"eipalloc-fake"}'

echo "14) 기존 인스턴스를 재사용할 때 데이터 볼륨·EIP 연결이 빠져 있으면 이어서 연결해야 한다"
FAKE_AWS_MODE=happy run_case c14 create "1.2.3.4/32" "$FULL_STATE" yes
[ "$CASE_RC" -eq 0 ] && ok=yes || ok=no
check "정상 종료" "$ok"
[[ "$CASE_LOG" == *"attach-volume"* ]] && ok=yes || ok=no
check "빠진 데이터 볼륨 연결을 이어서 수행함" "$ok"
[[ "$CASE_LOG" == *"associate-address"* ]] && ok=yes || ok=no
check "빠진 EIP 연결을 이어서 수행함" "$ok"

echo "15) 데이터 볼륨이 다른 인스턴스에 이미 연결돼 있으면 임의로 옮기지 않고 중단해야 한다"
FAKE_AWS_MODE=conn_vol_attached_other run_case c15 create "1.2.3.4/32" "$FULL_STATE" yes
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"데이터 볼륨"*"다른 인스턴스"* ]] && ok=yes || ok=no
check "다른 인스턴스 연결 감지 + 중단" "$ok"
[[ "$CASE_LOG" != *"attach-volume"* ]] && ok=yes || ok=no
check "연결을 임의로 옮기지(attach-volume 호출) 않음" "$ok"

echo "16) EIP가 다른 인스턴스에 이미 연결돼 있으면 임의로 옮기지 않고 중단해야 한다"
FAKE_AWS_MODE=conn_eip_attached_other run_case c16 create "1.2.3.4/32" "$FULL_STATE" yes
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"EIP"*"다른 인스턴스"* ]] && ok=yes || ok=no
check "다른 인스턴스 연결 감지 + 중단" "$ok"
[[ "$CASE_LOG" != *"associate-address"* ]] && ok=yes || ok=no
check "연결을 임의로 옮기지(associate-address 호출) 않음" "$ok"

echo "17) 데이터 볼륨·EIP가 이미 이 인스턴스에 정확히 연결돼 있으면 아무 것도 다시 하지 않고 완료로 표시해야 한다"
FAKE_AWS_MODE=conn_all_attached_same run_case c17 create "1.2.3.4/32" "$FULL_STATE" yes
[ "$CASE_RC" -eq 0 ] && ok=yes || ok=no
check "정상 종료" "$ok"
[[ "$CASE_LOG" != *"attach-volume"* && "$CASE_LOG" != *"associate-address"* ]] && ok=yes || ok=no
check "이미 연결된 상태에서는 재연결 호출을 하지 않음(멱등)" "$ok"

echo "18) 데이터 볼륨이 attaching 상태에서 끝내 attached로 넘어가지 않으면(시간 초과) — 자원은 그대로 두고 미완료로만 보고해야 한다"
FAKE_AWS_MODE=conn_vol_attaching_forever run_case c18 create "1.2.3.4/32" "$FULL_STATE" yes
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"부분 완료(연결 확인 안 됨)"* ]] && ok=yes || ok=no
check "시간 초과 시 실패 종료 + 부분 완료로 표시" "$ok"
[[ "$CASE_OUT" == *"미완료: 데이터 볼륨"* ]] && ok=yes || ok=no
check "어떤 연결이 미완료인지 구체적으로 보고함" "$ok"
[[ "$CASE_LOG" != *"attach-volume"* ]] && ok=yes || ok=no
check "이미 attaching 중이므로 attach-volume을 또 호출하지 않음" "$ok"

echo "19) 데이터 볼륨이 처음엔 attaching이다가 재조회 중 attached로 바뀌면 — 정상 완료로 확인해야 한다(지연 후 정상 완료)"
FAKE_AWS_MODE=conn_vol_attaches_after_delay VOLUME_ATTACH_WAIT_ATTEMPTS=3 run_case c19 create "1.2.3.4/32" "$FULL_STATE" yes
[ "$CASE_RC" -eq 0 ] && [[ "$CASE_OUT" != *"부분 완료"* ]] && ok=yes || ok=no
check "지연 후 attached로 확인되면 정상 완료로 표시" "$ok"
# describe-volumes가 여러 번 불려야(폴링이 실제로 일어났어야) 한다 — 최소 3회(재사용 존재
# 확인 1회 + 대기 루프 중 attaching/attached 확인 최소 2회).
VOL_CALL_COUNT="$(grep -c "describe-volumes" <<< "$CASE_LOG")"
[ "$VOL_CALL_COUNT" -ge 3 ] && ok=yes || ok=no
check "즉시 확정하지 않고 실제로 여러 번 재조회(폴링)함(${VOL_CALL_COUNT}회)" "$ok"

echo "20) EIP가 끝내 연결됨으로 확인되지 않으면(시간 초과) — 자원은 그대로 두고 미완료로만 보고해야 한다"
FAKE_AWS_MODE=conn_eip_never_associates run_case c20 create "1.2.3.4/32" "$FULL_STATE" yes
[ "$CASE_RC" -ne 0 ] && [[ "$CASE_OUT" == *"부분 완료(연결 확인 안 됨)"* ]] && ok=yes || ok=no
check "시간 초과 시 실패 종료 + 부분 완료로 표시" "$ok"
[[ "$CASE_OUT" == *"미완료: EIP"* ]] && ok=yes || ok=no
check "EIP 연결이 미완료라고 구체적으로 보고함" "$ok"

rm -rf "$FAKE_AWS_DIR"
echo
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
