import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { devKey, readJSON, writeJSON } from '../mocks/storage';

/**
 * 화면 전환은 아직 react-router 없이 단일 상태로 처리한다(0001·0003).
 * 가입·로그인·연인 연결처럼 히스토리·딥링크가 필요한 화면이 생기면 그때 라우터를 도입한다.
 */
export type AppTab = 'home' | 'chat' | 'week' | 'memories';
export type AppScreen = AppTab | 'settings';

export const APP_TABS: { id: AppTab; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '🏠' },
  { id: 'chat', label: '대화', icon: '💬' },
  { id: 'week', label: '이번 주 우리', icon: '🗓️' },
  { id: 'memories', label: '추억', icon: '📷' },
];

interface NavigationContextValue {
  screen: AppScreen;
  navigate: (screen: AppScreen) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);
const SCREEN_KEY = devKey('screen');

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<AppScreen>(() =>
    readJSON<AppScreen>(SCREEN_KEY, 'home'),
  );

  const value = useMemo<NavigationContextValue>(
    () => ({
      screen,
      navigate: (next) => {
        writeJSON(SCREEN_KEY, next);
        setScreenState(next);
      },
    }),
    [screen],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation은 NavigationProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
