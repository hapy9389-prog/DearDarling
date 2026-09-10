import { describe, expect, it } from 'vitest';
import {
  createDefaultTrialUserSettings,
  createDefaultUserSettings,
  isCoupleAnalysisActive,
} from '../consent';

describe('createDefaultTrialUserSettings — 신규 체험 기본값', () => {
  it('AI 분석 동의는 기본으로 꺼져 있다(가입과 동의 분리)', () => {
    const settings = createDefaultTrialUserSettings('trial-user-1');
    expect(settings.analysisConsent).toBe(false);
    expect(settings.coachingVisible).toBe(true);
    expect(settings.draftHelpEnabled).toBe(false);
  });

  it('둘 다 동의하지 않은 신규 커플은 커플 분석이 비활성이다', () => {
    const mine = createDefaultTrialUserSettings('trial-a');
    const partner = createDefaultTrialUserSettings('trial-b');
    expect(isCoupleAnalysisActive(mine, partner)).toBe(false);
  });

  it('검토 계정(민준·서연)의 기본값은 예전처럼 동의 켜짐으로 남는다', () => {
    expect(createDefaultUserSettings('user-minjun').analysisConsent).toBe(true);
  });
});

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
