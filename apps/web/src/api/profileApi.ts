import { apiGet, apiPatch, type Outcome } from './httpClient';

/**
 * 실제 프로필 API(`apps/api/src/routes/profile.ts`). 응답은 DB 행을 그대로 돌려준다
 * (snake_case) — 화면 쪽에서 쓰기 편하게 `toRealProfile`로 옮겨 담는다.
 */
export interface ApiUserRow {
  id: string;
  email: string | null;
  nickname: string | null;
  avatar_emoji: string | null;
  couple_id: string | null;
  analysis_consent: boolean;
}

export interface RealProfile {
  id: string;
  email: string;
  nickname: string;
  avatarEmoji: string;
  coupleId: string | null;
}

export function toRealProfile(row: ApiUserRow): RealProfile {
  return {
    id: row.id,
    email: row.email ?? '',
    nickname: row.nickname ?? '',
    avatarEmoji: row.avatar_emoji ?? '',
    coupleId: row.couple_id,
  };
}

export function getProfile(): Promise<Outcome<ApiUserRow>> {
  return apiGet('/api/profile');
}

export function updateProfile(
  patch: { nickname?: string; avatarEmoji?: string },
): Promise<Outcome<ApiUserRow>> {
  return apiPatch('/api/profile', patch);
}
