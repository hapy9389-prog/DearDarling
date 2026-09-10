import type { ReactNode } from 'react';
import { NavigationProvider } from '../state/NavigationContext';
import { ActiveAccountProvider } from '../state/ActiveAccountContext';
import { ScenarioProvider } from '../state/ScenarioContext';
import { SettingsProvider } from '../state/SettingsContext';
import { PatternProvider } from '../state/PatternContext';
import { MemoriesProvider } from '../state/MemoriesContext';

/**
 * 본 앱(`/app`) 화면이 쓰는 Context 스택. 연결된 커플이 있다는 전제 아래 동작하므로
 * 가입·로그인·연인 연결 같은 프리-`/app` 화면에는 마운트하지 않는다(0010).
 * 라우터 도입 전에는 App.tsx가 직접 감싸고 있었다.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <ScenarioProvider>
        <ActiveAccountProvider>
          <SettingsProvider>
            <PatternProvider>
              <MemoriesProvider>{children}</MemoriesProvider>
            </PatternProvider>
          </SettingsProvider>
        </ActiveAccountProvider>
      </ScenarioProvider>
    </NavigationProvider>
  );
}
