import { ScreenContainer } from './shared/components/ScreenContainer';
import { AppShell } from './app-shell/AppShell';
import { DevPanel } from './features/dev/DevPanel';
import { NavigationProvider } from './state/NavigationContext';
import { ActiveAccountProvider } from './state/ActiveAccountContext';
import { ScenarioProvider } from './state/ScenarioContext';
import { SettingsProvider } from './state/SettingsContext';

export function App() {
  return (
    <NavigationProvider>
      <ScenarioProvider>
        <ActiveAccountProvider>
          <SettingsProvider>
            <ScreenContainer>
              <AppShell />
              <DevPanel />
            </ScreenContainer>
          </SettingsProvider>
        </ActiveAccountProvider>
      </ScenarioProvider>
    </NavigationProvider>
  );
}
