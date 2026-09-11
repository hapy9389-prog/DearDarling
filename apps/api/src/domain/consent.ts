/**
 * apps/web/src/mocks/domain/consent.ts §3 규칙: 커플 분석은 두 사람 모두
 * analysisConsent가 true일 때만 활성화되고, 한쪽이라도 철회하면 즉시 비활성화된다.
 * 서버 쪽은 users.analysis_consent(boolean) 두 값을 그대로 넘겨받아 판단한다.
 */
export function isCoupleAnalysisActive(mineConsent: boolean, partnerConsent: boolean): boolean {
  return mineConsent && partnerConsent;
}
