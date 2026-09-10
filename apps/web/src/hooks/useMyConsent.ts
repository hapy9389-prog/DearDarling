import { useState } from 'react';
import { createMockSettingsService } from '../mocks/services/settingsService';

const settingsService = createMockSettingsService();

/**
 * 내 AI 분석 동의만 읽고 쓰는 훅(0010). 상대·`coupleAnalysisActive`는 다루지 않으므로
 * `/consent`처럼 연결 전(=`/app` Provider가 없는) 화면에서도 쓸 수 있다.
 *
 * `userId`가 바뀌면(세션/시점 전환) 그 사용자의 저장된 값을 렌더 중에 곧바로 다시 읽는다 —
 * 이전 사용자의 화면 상태가 남거나, 새 사용자 설정으로 잘못 저장되지 않도록 한다.
 */
export function useMyConsent(userId: string): {
  analysisConsent: boolean;
  setAnalysisConsent: (value: boolean) => void;
} {
  const [analysisConsent, setValue] = useState(
    () => settingsService.getSettings(userId).analysisConsent,
  );
  const [loadedUserId, setLoadedUserId] = useState(userId);
  if (loadedUserId !== userId) {
    setLoadedUserId(userId);
    setValue(settingsService.getSettings(userId).analysisConsent);
  }

  return {
    analysisConsent,
    setAnalysisConsent: (value) => {
      const next = settingsService.updateSettings(userId, { analysisConsent: value });
      setValue(next.analysisConsent);
    },
  };
}
