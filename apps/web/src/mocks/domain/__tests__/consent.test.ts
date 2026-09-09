import { describe, expect, it } from 'vitest';
import { createDefaultUserSettings, isCoupleAnalysisActive } from '../consent';

describe('isCoupleAnalysisActive — 분석 철회 규칙', () => {
  it('두 사람 모두 동의하면 커플 분석이 활성화된다', () => {
    const mine = createDefaultUserSettings('user-a');
    const partner = createDefaultUserSettings('user-b');
    expect(isCoupleAnalysisActive(mine, partner)).toBe(true);
  });

  it('한쪽이라도 철회하면 즉시 비활성화된다', () => {
    const withdrawn = { ...createDefaultUserSettings('user-a'), analysisConsent: false };
    const stillConsenting = createDefaultUserSettings('user-b');

    expect(isCoupleAnalysisActive(withdrawn, stillConsenting)).toBe(false);
    // 어느 쪽 인자로 넣어도(본인이 철회했든 상대가 철회했든) 결과는 동일해야 한다.
    expect(isCoupleAnalysisActive(stillConsenting, withdrawn)).toBe(false);
  });

  it('둘 다 철회하면 비활성화된다', () => {
    const a = { ...createDefaultUserSettings('user-a'), analysisConsent: false };
    const b = { ...createDefaultUserSettings('user-b'), analysisConsent: false };
    expect(isCoupleAnalysisActive(a, b)).toBe(false);
  });

  it('코칭 숨기기(coachingVisible)는 분석 활성화 여부에 영향을 주지 않는다', () => {
    const hidden = { ...createDefaultUserSettings('user-a'), coachingVisible: false };
    const partner = createDefaultUserSettings('user-b');
    // coachingVisible이 꺼져 있어도 analysisConsent가 true라면 분석은 계속 활성 상태다.
    expect(isCoupleAnalysisActive(hidden, partner)).toBe(true);
  });
});
