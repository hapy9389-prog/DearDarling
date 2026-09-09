import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { devKey, readJSON, writeJSON } from '../mocks/storage';

/**
 * 화면 전환은 아직 react-router 없이 단일 상태로 처리한다(0001·0003).
 * 가입·로그인·연인 연결처럼 히스토리·딥링크가 필요한 화면이 생기면 그때 라우터를 도입한다.
 */
export type AppTab = 'home' | 'chat' | 'week' | 'memories';
/** 'settings'·'ask'는 탭이 아니라 하위 화면(← 버튼으로 돌아온다). */
export type AppScreen = AppTab | 'settings' | 'ask';

export const APP_TABS: { id: AppTab; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '🏠' },
  { id: 'chat', label: '대화', icon: '💬' },
  // 내부 id는 'week'지만, 주간 리포트 + AI 상담을 아우르므로 라벨은 '우리'.
  { id: 'week', label: '우리', icon: '🗓️' },
  { id: 'memories', label: '추억', icon: '📷' },
];

/** 화면 이동 시 함께 넘기는 가벼운 파라미터. 저장하지 않는다(새로고침하면 초기화). */
export interface NavigateParams {
  /** 추억 탭을 열 때 바로 펼칠 추억 id(홈의 '최근 추억' → 상세). */
  memoryId?: string;
}

interface NavigationContextValue {
  screen: AppScreen;
  params: NavigateParams;
  navigate: (screen: AppScreen, params?: NavigateParams) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);
const SCREEN_KEY = devKey('screen');

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<AppScreen>(() =>
    readJSON<AppScreen>(SCREEN_KEY, 'home'),
  );
  const [params, setParams] = useState<NavigateParams>({});

  const value = useMemo<NavigationContextValue>(
    () => ({
      screen,
      params,
      navigate: (next, nextParams = {}) => {
        writeJSON(SCREEN_KEY, next);
        setScreenState(next);
        setParams(nextParams);
      },
    }),
    [screen, params],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation은 NavigationProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
