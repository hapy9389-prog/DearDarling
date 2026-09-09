import { ScreenContainer } from './shared/components/ScreenContainer';
import { AppShell } from './app-shell/AppShell';
import { ChatPage } from './features/chat/ChatPage';
import { DevPanel } from './features/dev/DevPanel';
import { ActiveAccountProvider } from './state/ActiveAccountContext';
import { ScenarioProvider } from './state/ScenarioContext';
import { SettingsProvider } from './state/SettingsContext';

export function App() {
  return (
    <ScenarioProvider>
      <ActiveAccountProvider>
        <SettingsProvider>
          <ScreenContainer>
            <AppShell>
              <ChatPage />
            </AppShell>
            <DevPanel />
          </ScreenContainer>
        </SettingsProvider>
      </ActiveAccountProvider>
    </ScenarioProvider>
  );
}
