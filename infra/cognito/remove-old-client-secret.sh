#!/bin/bash
# 실제 로그인이 새 Secret으로 정상 동작함을 확인한 뒤에만 실행한다. 노출됐던 이전 Secret을
# 삭제하고, 삭제 후 목록을 다시 조회해 이전 SecretId가 더 이상 없는지 확인한다.
# 재시도해도 이미 지워진 SecretId를 다시 지우려 하면 AWS가 자연스럽게 오류를 내므로(이미 없는
# 대상), 중복 삭제 시도로 인한 부작용은 없다 — 다만 이 스크립트는 새 Secret을 다시 추가하지
# 않는다(추가는 add-client-secret.sh의 역할).
#
# 사용법: ./infra/cognito/remove-old-client-secret.sh
set -euo pipefail
PROFILE="tunibridge"
REGION="ap-northeast-2"
USER_POOL_ID="ap-northeast-2_KsD6f5gio"
CLIENT_ID="69csra3gm8mbsg8tcu51tdj4rb"
OLD_SECRET_ID="69csra3gm8mbsg8tcu51tdj4rb--1789204881327"  # 노출된 최초 생성 Secret

aws_cmd() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

echo "[1/2] 이전 Secret 삭제 요청 중: $OLD_SECRET_ID"
if ! aws_cmd cognito-idp delete-user-pool-client-secret \
    --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" --client-secret-id "$OLD_SECRET_ID" 2>&1; then
  echo "삭제 실패 — 권한 부족이거나(cognito-idp:DeleteUserPoolClientSecret 필요) 마지막 남은" \
       "Secret이라 삭제가 거부됐을 수 있습니다. 이전 Secret은 아직 유효한 상태이며 교체가" \
       "완료되지 않았습니다." >&2
  exit 1
fi

echo "[2/2] 삭제 후 목록 재확인 중(값 없음, 안전하게 출력)..."
LIST_JSON="$(aws_cmd cognito-idp list-user-pool-client-secrets \
  --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" --output json)"
echo "$LIST_JSON"
STILL_THERE="$(node -e "
  const d=JSON.parse(process.argv[1]);
  console.log((d.ClientSecrets||[]).some(s=>s.ClientSecretId==='$OLD_SECRET_ID') ? 'yes':'no');
" "$LIST_JSON")"
if [ "$STILL_THERE" = "yes" ]; then
  echo "삭제 API는 성공했다고 응답했지만 목록에 여전히 남아 있습니다 — 확인이 필요합니다." >&2
  exit 1
fi
echo "완료 — 노출됐던 이전 Secret이 삭제되고, 목록에서도 사라졌음을 확인했습니다."
