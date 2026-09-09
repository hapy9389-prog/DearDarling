import type { UserSettings } from '../types';

export function createDefaultUserSettings(userId: string): UserSettings {
  return {
    userId,
    // 화면 검토 시드는 "정상 상태"를 기본으로 보여주기 위해 둘 다 동의한 상태로 시작한다.
    // 동의 대기/철회 상태는 대화 화면의 임시 설정 미리보기 토글로 확인한다.
    analysisConsent: true,
    coachingVisible: true,
    draftHelpEnabled: false,
  };
}

/**
 * 커플 분석(코칭 생성 포함)은 두 사람 모두 analysisConsent가 true일 때만 활성화된다.
 * 한쪽이라도 철회하면 즉시 비활성화된다 — 문서 4장 "분석 가능 구간" 규칙.
 * coachingVisible(코칭 숨기기)은 여기 관여하지 않는다: 그건 각자의 화면 표시 설정일 뿐이다.
 */
export function isCoupleAnalysisActive(mine: UserSettings, partner: UserSettings): boolean {
  return mine.analysisConsent && partner.analysisConsent;
}
