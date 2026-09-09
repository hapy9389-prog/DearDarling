import { ScreenContainer } from './shared/components/ScreenContainer';
import { AppShell } from './app-shell/AppShell';
import { DevPanel } from './features/dev/DevPanel';
import { NavigationProvider } from './state/NavigationContext';
import { ActiveAccountProvider } from './state/ActiveAccountContext';
import { ScenarioProvider } from './state/ScenarioContext';
import { SettingsProvider } from './state/SettingsContext';
import { PatternProvider } from './state/PatternContext';
import { MemoriesProvider } from './state/MemoriesContext';

export function App() {
  return (
    <NavigationProvider>
      <ScenarioProvider>
        <ActiveAccountProvider>
          <SettingsProvider>
            <PatternProvider>
              <MemoriesProvider>
                <ScreenContainer>
                  <AppShell />
                  <DevPanel />
                </ScreenContainer>
              </MemoriesProvider>
            </PatternProvider>
          </SettingsProvider>
        </ActiveAccountProvider>
      </ScenarioProvider>
    </NavigationProvider>
  );
}
