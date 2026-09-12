import { apiGet, apiPatch, type Outcome } from './httpClient';

/**
 * 실제 커플 API(`apps/api/src/routes/couple.ts`). `coupleId`는 항상 서버가 "내 계정의"
 * couple_id에서만 찾아 응답한다 — 클라이언트가 다른 커플의 id를 지정할 방법 자체가 없다.
 */

export interface ApiPartnerInfo {
  nickname: string | null;
  avatar_emoji: string | null;
}

export interface ApiCoupleRow {
  id: string;
  connected_at: string;
  relationship_start_date: string | null;
  is_seed: boolean;
  /** 이메일 등 계정 정보는 없다 — 서버가 닉네임·아바타만 내려준다. */
  partner: ApiPartnerInfo | null;
}

export interface RealCouple {
  id: string;
  connectedAt: string;
  relationshipStartDate: string | null;
  partnerNickname: string;
  partnerAvatarEmoji: string;
}

export function toRealCouple(row: ApiCoupleRow): RealCouple {
  return {
    id: row.id,
    connectedAt: row.connected_at,
    relationshipStartDate: row.relationship_start_date,
    partnerNickname: row.partner?.nickname ?? '',
    partnerAvatarEmoji: row.partner?.avatar_emoji ?? '',
  };
}

export function getCouple(): Promise<Outcome<ApiCoupleRow>> {
  return apiGet('/api/couple');
}

export function updateCouple(
  patch: { relationshipStartDate?: string | null },
): Promise<Outcome<ApiCoupleRow>> {
  return apiPatch('/api/couple', patch);
}
