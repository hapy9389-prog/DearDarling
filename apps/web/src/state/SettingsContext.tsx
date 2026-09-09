import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createMockSettingsService } from '../mocks/services/settingsService';
import { isCoupleAnalysisActive } from '../mocks/domain/consent';
import type { UserSettings } from '../mocks/types';
import { useActiveAccount } from './ActiveAccountContext';

const settingsService = createMockSettingsService();

interface SettingsContextValue {
  mine: UserSettings;
  partner: UserSettings;
  /** 두 사람 모두 분석에 동의했는지 — 코칭/패턴 활용의 전제 조건. */
  coupleAnalysisActive: boolean;
  updateMine: (patch: Partial<Omit<UserSettings, 'userId'>>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { account, partner } = useActiveAccount();
  const [mine, setMine] = useState<UserSettings>(() => settingsService.getSettings(account.id));
  const [partnerSettings, setPartnerSettings] = useState<UserSettings>(() =>
    settingsService.getSettings(partner.id),
  );

  // 테스트 계정을 전환하면 그 사람의 설정을 다시 불러온다 — 이전 계정의 설정이 남아있지 않도록.
  // 렌더 중에 바로 조정해(React 권장 패턴) 이펙트 안에서 동기적으로 setState하지 않는다.
  const [loadedForAccountId, setLoadedForAccountId] = useState(account.id);
  if (loadedForAccountId !== account.id) {
    setLoadedForAccountId(account.id);
    setMine(settingsService.getSettings(account.id));
    setPartnerSettings(settingsService.getSettings(partner.id));
  }

  const value = useMemo<SettingsContextValue>(
    () => ({
      mine,
      partner: partnerSettings,
      coupleAnalysisActive: isCoupleAnalysisActive(mine, partnerSettings),
      updateMine: (patch) => {
        const next = settingsService.updateSettings(account.id, patch);
        setMine(next);
      },
    }),
    [mine, partnerSettings, account.id],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings는 SettingsProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
