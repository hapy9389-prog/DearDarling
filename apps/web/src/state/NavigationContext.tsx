import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * 화면 전환은 react-router 위에서 동작한다(0010). 이 컨텍스트는 기존 공개 API
 * (`screen`, `params`, `navigate`, `APP_TABS`)를 그대로 유지하는 얇은 어댑터다 —
 * 기능 컴포넌트는 `navigate('chat')`처럼 예전과 똑같이 부른다.
 *  - `screen`: 현재 URL(`/app/<screen>`)에서 파생.
 *  - `navigate(screen, params)`: `/app/<screen>`로 이동하고 `params`는 history state로 넘긴다.
 *  - 뒤로가기·앞으로가기·새로고침·딥링크는 브라우저/라우터가 처리한다.
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

const APP_SCREENS: readonly AppScreen[] = ['home', 'chat', 'week', 'memories', 'settings', 'ask'];

/** 화면 이동 시 함께 넘기는 가벼운 파라미터. history state로만 전달한다(하드 리프레시하면 초기화). */
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
const EMPTY_PARAMS: NavigateParams = {};

/** `/app/week` → 'week', `/app` 또는 알 수 없는 경로 → 'home'. */
function screenFromPathname(pathname: string): AppScreen {
  const segment = pathname.replace(/^\/app\/?/, '').split('/')[0];
  return APP_SCREENS.includes(segment as AppScreen) ? (segment as AppScreen) : 'home';
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const routerNavigate = useNavigate();

  const screen = screenFromPathname(location.pathname);
  const rawState = location.state as NavigateParams | null;
  // navigate()는 호출마다 새 state 객체를 만들고, state가 없으면 항상 같은 EMPTY_PARAMS를 돌려준다 —
  // MemoriesPage가 "params 레퍼런스가 바뀌면 목록으로 되돌린다"는 판단을 그대로 할 수 있게 한다.
  const params = useMemo(() => rawState ?? EMPTY_PARAMS, [rawState]);

  const value = useMemo<NavigationContextValue>(
    () => ({
      screen,
      params,
      navigate: (next, nextParams = {}) => {
        routerNavigate(`/app/${next}`, { state: nextParams });
      },
    }),
    [screen, params, routerNavigate],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation은 NavigationProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
