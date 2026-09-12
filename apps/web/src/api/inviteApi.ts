import { apiGet, apiPost, type Outcome } from './httpClient';

/**
 * 실제 초대 API(`apps/api/src/routes/invites.ts`). 응답은 DB 행/서비스 결과를 그대로
 * 돌려준다(snake_case 필드는 그대로 유지) — 화면 쪽 매핑은 호출부에서 한다.
 */

export interface ApiInviteRow {
  id: string;
  code: string;
  inviter_user_id: string;
  accepted_by_user_id: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

/** 이메일·인증·세션 관련 정보는 담지 않는다(서버가 애초에 이 두 필드만 내려준다). */
export interface ApiInvitePreview {
  inviter_nickname: string | null;
  inviter_avatar_emoji: string | null;
}

/** 이미 활성 초대가 있으면 새로 만들지 않고 그걸 그대로 돌려준다(멱등) — "내 초대 코드
 * 가져오기"로도 그대로 쓸 수 있다. */
export function createInvite(): Promise<Outcome<ApiInviteRow>> {
  return apiPost('/api/invites', {});
}

/** 로그인한 사용자만 호출 가능(서버가 인증을 강제) — 조회만으로 초대를 사용 처리하거나
 * 커플을 연결하지 않는다. 반복 조회는 서버가 요청 제한을 건다(429). */
export function previewInvite(code: string): Promise<Outcome<ApiInvitePreview>> {
  return apiGet(`/api/invites/${encodeURIComponent(code)}`);
}

export function acceptInvite(
  code: string,
  relationshipStartDate: string | null,
): Promise<Outcome<{ coupleId: string }>> {
  return apiPost(`/api/invites/${encodeURIComponent(code)}/accept`, { relationshipStartDate });
}

export function revokeInvite(code: string): Promise<Outcome<undefined>> {
  return apiPost(`/api/invites/${encodeURIComponent(code)}/revoke`, {});
}
