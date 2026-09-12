import type { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { ScreenContainer } from '../shared/components/ScreenContainer';
import { AppShell } from '../app-shell/AppShell';
import { AppProviders } from '../app-shell/AppProviders';
import { OnboardingShell } from '../app-shell/OnboardingShell';
import { DevPanelProvider } from '../features/dev/DevPanel';
import { SessionProvider, useSession } from '../state/SessionContext';
import {
  BlockRealAccounts,
  RequireAuth,
  RequireConnected,
  RequireProfileComplete,
  RequireRealAccount,
  RequireRealProfileComplete,
  RedirectIfAuthed,
  RedirectIfConnected,
  RedirectIfRealConnected,
} from './guards';
import { StartScreen } from '../features/auth/StartScreen';
import { SignUpScreen } from '../features/auth/SignUpScreen';
import { LogInScreen } from '../features/auth/LogInScreen';
import { PasswordResetScreen } from '../features/auth/PasswordResetScreen';
import { RealHomeScreen } from '../features/auth/RealHomeScreen';
import { ProfileScreen } from '../features/onboarding/ProfileScreen';
import { AnalysisConsentScreen } from '../features/onboarding/AnalysisConsentScreen';
import { ConnectHubScreen } from '../features/onboarding/ConnectHubScreen';
import { JoinByCodeScreen } from '../features/onboarding/JoinByCodeScreen';
import { RealConnectScreen } from '../features/onboarding/RealConnectScreen';
import { RealJoinByCodeScreen } from '../features/onboarding/RealJoinByCodeScreen';
import { RealAnalysisConsentScreen } from '../features/onboarding/RealAnalysisConsentScreen';

/** 초기 세션 확인(GET /api/auth/me) 동안 아무 라우트도 보여주지 않는다 — 로그인 여부가 아직
 * 확정되지 않은 채로 시작 화면이나 앱 화면이 잠깐 보였다 바뀌는 걸 막는다. 실패하면(네트워크
 * 오류) 성공도 실패도 아닌 재시도 화면을 보여준다. */
function SessionGate({ children }: { children: ReactNode }) {
  const { initializing, initError, retryInitialization } = useSession();
  // initError를 항상 먼저 본다 — initializing이 어떤 값이든(정의상 실패 중엔 true로 유지되지만,
  // 여기서도 한 번 더 강제한다) 확인 실패 상태를 건너뛰고 일반 화면으로 새지 않게 한다.
  if (initError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-ink-soft">로그인 상태를 확인하지 못했습니다.</p>
        <button
          type="button"
          onClick={retryInitialization}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-ink"
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (!initializing) return <>{children}</>;
  return <div className="flex flex-1 items-center justify-center" aria-busy="true" />;
}

/**
 * 라우트 테이블(0010, 이후 실제 계정 연결로 확장). 온보딩(시작·가입·로그인·프로필·동의·연결)은
 * react-router로 화면을 오가고, 기존 4탭 + 하위 화면은 `/app/*` 레이아웃 라우트 하나 아래
 * `AppShell`이 담당한다 — `/app` 안에 있는 한 `ChatPage`는 마운트를 유지한다(0003 §3).
 *
 * `/real/*`는 실제 Cognito 계정 전용이다(프로필·초대·커플 연결·동의까지 — 대화·AI 코칭 등
 * `/app/*` 본편은 아직 다음 단계). `BlockRealAccounts`가 그 외 온보딩·앱(mock) 라우트에서
 * 실제 계정을 걸러낸다.
 */
export function AppRouter() {
  return (
    <SessionProvider>
      <ScreenContainer>
        <SessionGate>
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
                    <OnboardingShell mock={false}>
                      <SignUpScreen />
                    </OnboardingShell>
                  }
                />
                <Route
                  path="/login"
                  element={
                    <OnboardingShell mock={false}>
                      <LogInScreen />
                    </OnboardingShell>
                  }
                />
              </Route>

              <Route
                path="/reset"
                element={
                  <OnboardingShell mock={false}>
                    <PasswordResetScreen />
                  </OnboardingShell>
                }
              />

              <Route element={<RequireAuth />}>
                <Route element={<RequireRealAccount />}>
                  <Route
                    path="/real/profile"
                    element={
                      <OnboardingShell mock={false}>
                        <ProfileScreen />
                      </OnboardingShell>
                    }
                  />
                  <Route
                    path="/real/home"
                    element={
                      <OnboardingShell mock={false}>
                        <RealHomeScreen />
                      </OnboardingShell>
                    }
                  />
                  <Route element={<RequireRealProfileComplete />}>
                    <Route
                      path="/real/consent"
                      element={
                        <OnboardingShell mock={false}>
                          <RealAnalysisConsentScreen />
                        </OnboardingShell>
                      }
                    />
                    <Route element={<RedirectIfRealConnected />}>
                      <Route
                        path="/real/connect"
                        element={
                          <OnboardingShell mock={false}>
                            <RealConnectScreen />
                          </OnboardingShell>
                        }
                      />
                      <Route
                        path="/real/connect/join"
                        element={
                          <OnboardingShell mock={false}>
                            <RealJoinByCodeScreen />
                          </OnboardingShell>
                        }
                      />
                    </Route>
                  </Route>
                </Route>

                <Route element={<BlockRealAccounts />}>
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
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </DevPanelProvider>
        </SessionGate>
      </ScreenContainer>
    </SessionProvider>
  );
}
