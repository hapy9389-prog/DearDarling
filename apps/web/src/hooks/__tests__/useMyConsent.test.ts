import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMyConsent } from '../useMyConsent';
import { createMockSettingsService } from '../../mocks/services/settingsService';
import { resetAllMockData } from '../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

describe('useMyConsent — 계정 전환 시 저장값을 다시 읽는다(회귀)', () => {
  it('A→B→A 전환 시 각자의 표시값이 저장값과 일치한다', () => {
    const settings = createMockSettingsService();
    settings.updateSettings('trial-user-a', { analysisConsent: true });
    settings.updateSettings('trial-user-b', { analysisConsent: false });

    const { result, rerender } = renderHook(({ userId }) => useMyConsent(userId), {
      initialProps: { userId: 'trial-user-a' },
    });
    expect(result.current.analysisConsent).toBe(true);

    // B로 전환 — 저장된 B의 값(꺼짐)이 보여야 한다
    rerender({ userId: 'trial-user-b' });
    expect(result.current.analysisConsent).toBe(false);

    // 다시 A로 — A의 값(켜짐) 유지
    rerender({ userId: 'trial-user-a' });
    expect(result.current.analysisConsent).toBe(true);
  });

  it('B의 토글은 B의 설정에만 저장되고 A는 그대로다', () => {
    const settings = createMockSettingsService();
    settings.updateSettings('trial-user-a', { analysisConsent: true });

    const { result, rerender } = renderHook(({ userId }) => useMyConsent(userId), {
      initialProps: { userId: 'trial-user-a' },
    });
    rerender({ userId: 'trial-user-b' });

    act(() => result.current.setAnalysisConsent(true));

    expect(settings.getSettings('trial-user-b').analysisConsent).toBe(true);
    expect(settings.getSettings('trial-user-a').analysisConsent).toBe(true); // 손대지 않음

    rerender({ userId: 'trial-user-a' });
    expect(result.current.analysisConsent).toBe(true);
  });
});
