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
 * 신규 체험 사용자의 기본 설정(0010). AI 분석 동의는 기본 꺼짐 —
 * 가입과 동의를 분리하고, 동의하지 않아도 연결·대화를 이용할 수 있게 한다.
 * 가입 시 authService가 이 값을 명시적으로 저장한다(서버 default를 흉내내는 seam).
 */
export function createDefaultTrialUserSettings(userId: string): UserSettings {
  return {
    userId,
    analysisConsent: false,
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
