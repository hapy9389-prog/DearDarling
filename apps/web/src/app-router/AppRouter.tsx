import { Routes, Route, Navigate } from 'react-router';
import { ScreenContainer } from '../shared/components/ScreenContainer';
import { AppShell } from '../app-shell/AppShell';
import { AppProviders } from '../app-shell/AppProviders';
import { OnboardingShell } from '../app-shell/OnboardingShell';
import { DevPanelProvider } from '../features/dev/DevPanel';
import { SessionProvider } from '../state/SessionContext';
import {
  RequireAuth,
  RequireConnected,
  RequireProfileComplete,
  RedirectIfAuthed,
  RedirectIfConnected,
} from './guards';
import { StartScreen } from '../features/auth/StartScreen';
import { SignUpScreen } from '../features/auth/SignUpScreen';
import { LogInScreen } from '../features/auth/LogInScreen';
import { PasswordResetScreen } from '../features/auth/PasswordResetScreen';
import { ProfileScreen } from '../features/onboarding/ProfileScreen';
import { AnalysisConsentScreen } from '../features/onboarding/AnalysisConsentScreen';
import { ConnectHubScreen } from '../features/onboarding/ConnectHubScreen';
import { JoinByCodeScreen } from '../features/onboarding/JoinByCodeScreen';

/**
 * 라우트 테이블(0010). 온보딩(시작·가입·로그인·프로필·동의·연결)은 react-router로 화면을 오가고,
 * 기존 4탭 + 하위 화면은 `/app/*` 레이아웃 라우트 하나 아래 `AppShell`이 담당한다 —
 * `/app` 안에 있는 한 `ChatPage`는 마운트를 유지한다(0003 §3).
 */
export function AppRouter() {
  return (
    <SessionProvider>
      <ScreenContainer>
        <DevPanelProvider>
          <Routes>
            <Route element={<RedirectIfAuthed />}>
              <Route
                path="/"
                element={
                  <OnboardingShell>
                    <StartScreen />
                  </OnboardingShell>
                }
              />
              <Route
                path="/signup"
                element={
                  <OnboardingShell>
                    <SignUpScreen />
                  </OnboardingShell>
                }
              />
              <Route
                path="/login"
                element={
                  <OnboardingShell>
                    <LogInScreen />
                  </OnboardingShell>
                }
              />
            </Route>

            <Route
              path="/reset"
              element={
                <OnboardingShell>
                  <PasswordResetScreen />
                </OnboardingShell>
              }
            />

            <Route element={<RequireAuth />}>
              <Route
                path="/onboarding/profile"
                element={
                  <OnboardingShell>
                    <ProfileScreen />
                  </OnboardingShell>
                }
              />

              <Route element={<RequireProfileComplete />}>
                <Route element={<RedirectIfConnected />}>
                  <Route
                    path="/consent"
                    element={
                      <OnboardingShell>
                        <AnalysisConsentScreen />
                      </OnboardingShell>
                    }
                  />
                  <Route
                    path="/connect"
                    element={
                      <OnboardingShell>
                        <ConnectHubScreen />
                      </OnboardingShell>
                    }
                  />
                  <Route
                    path="/connect/join"
                    element={
                      <OnboardingShell>
                        <JoinByCodeScreen />
                      </OnboardingShell>
                    }
                  />
                </Route>

                <Route element={<RequireConnected />}>
                  <Route
                    path="/app/*"
                    element={
                      <AppProviders>
                        <AppShell />
                      </AppProviders>
                    }
                  />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </DevPanelProvider>
      </ScreenContainer>
    </SessionProvider>
  );
}
