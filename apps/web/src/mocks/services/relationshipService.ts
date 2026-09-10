import type { CoupleProfile } from '../types';
import { SEED_COUPLE_PROFILE } from '../fixtures/couple';
import { SEED_TODAY_SUMMARY } from '../fixtures/home';
import { isReviewCouple } from '../fixtures/accounts';
import { coupleKey, readJSON, writeJSON } from '../storage';

/**
 * 홈 화면이 쓰는 커플 단위 정보(프로필, 오늘의 대화 요약).
 * 검토 커플(민준·서연)은 고정 시드를, 신규 체험 커플은 저장된 프로필을 돌려준다 —
 * 실제 API가 생기면 이 인터페이스만 HTTP(GET/PATCH /couples/:id)로 교체한다(0010).
 */
export interface RelationshipService {
  getCoupleProfile(coupleId: string): CoupleProfile;
  updateCoupleProfile(
    coupleId: string,
    patch: { relationshipStartDate: string | null },
  ): CoupleProfile;
  /** 오늘 나눈 대화를 요약한 한 줄(검토 커플 전용 가상 예시). 체험 커플은 null(요약을 제공하지 않음). */
  getTodaySummary(coupleId: string): string | null;
}

function profileKey(coupleId: string): string {
  return coupleKey(coupleId, 'profile');
}

function trialProfileFallback(coupleId: string): CoupleProfile {
  return { coupleId, connectedAt: new Date().toISOString(), relationshipStartDate: null };
}

export function createMockRelationshipService(): RelationshipService {
  return {
    getCoupleProfile(coupleId) {
      if (isReviewCouple(coupleId)) return SEED_COUPLE_PROFILE;
      return readJSON<CoupleProfile>(profileKey(coupleId), trialProfileFallback(coupleId));
    },

    updateCoupleProfile(coupleId, patch) {
      const current = isReviewCouple(coupleId)
        ? SEED_COUPLE_PROFILE
        : readJSON<CoupleProfile>(profileKey(coupleId), trialProfileFallback(coupleId));
      const next: CoupleProfile = { ...current, ...patch, coupleId };
      writeJSON(profileKey(coupleId), next);
      return next;
    },

    getTodaySummary(coupleId) {
      return isReviewCouple(coupleId) ? SEED_TODAY_SUMMARY : null;
    },
  };
}
