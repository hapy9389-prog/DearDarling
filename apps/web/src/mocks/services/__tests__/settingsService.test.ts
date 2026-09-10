import { afterEach, describe, expect, it } from 'vitest';
import { createMockSettingsService } from '../settingsService';
import { resetAllMockData } from '../../storage';

afterEach(() => {
  resetAllMockData();
});

describe('settingsService — 계정별 데이터 분리', () => {
  it('한 계정의 설정 변경이 다른 계정에 섞이지 않는다', () => {
    const service = createMockSettingsService();

    service.updateSettings('user-minjun', { analysisConsent: false, coachingVisible: false });

    const minjun = service.getSettings('user-minjun');
    const seoyeon = service.getSettings('user-seoyeon');

    expect(minjun.analysisConsent).toBe(false);
    expect(minjun.coachingVisible).toBe(false);
    // 서연 계정은 손댄 적이 없으므로 기본값(둘 다 true)을 유지해야 한다 — 민준의 변경이 새어나가지 않음.
    expect(seoyeon.analysisConsent).toBe(true);
    expect(seoyeon.coachingVisible).toBe(true);
  });
});

describe('settingsService — 신규 체험 vs 검토 계정 기본값', () => {
  it('신규 체험 사용자는 AI 분석 동의가 기본 꺼짐이다', () => {
    const service = createMockSettingsService();
    expect(service.getSettings('trial-user-abc').analysisConsent).toBe(false);
  });

  it('검토 계정(민준·서연)은 기본 켜짐을 유지한다', () => {
    const service = createMockSettingsService();
    expect(service.getSettings('user-minjun').analysisConsent).toBe(true);
    expect(service.getSettings('user-seoyeon').analysisConsent).toBe(true);
  });

  it('이미 저장된 설정 행은 기본값 분기와 무관하게 그대로 읽힌다', () => {
    const service = createMockSettingsService();
    service.updateSettings('trial-user-abc', { analysisConsent: true });
    expect(service.getSettings('trial-user-abc').analysisConsent).toBe(true);
  });
});
