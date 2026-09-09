import type { CoupleProfile } from '../types';
import { SEED_COUPLE_PROFILE } from '../fixtures/couple';
import { SEED_TODAY_SUMMARY } from '../fixtures/home';

/**
 * 홈 화면이 쓰는 커플 단위 정보(프로필, 오늘의 대화 요약).
 * 지금은 고정 시드를 돌려주는 정적 구현이다 — 실제 API가 생기면 이 인터페이스만 HTTP로 교체한다.
 */
export interface RelationshipService {
  getCoupleProfile(coupleId: string): CoupleProfile;
  /** 오늘 나눈 대화를 요약한 한 줄(가상 예시). */
  getTodaySummary(coupleId: string): string;
}

export function createMockRelationshipService(): RelationshipService {
  return {
    getCoupleProfile(coupleId) {
      if (coupleId !== SEED_COUPLE_PROFILE.coupleId) {
        throw new Error(`알 수 없는 커플입니다: ${coupleId}`);
      }
      return SEED_COUPLE_PROFILE;
    },
    getTodaySummary() {
      return SEED_TODAY_SUMMARY;
    },
  };
}
