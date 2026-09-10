import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import type { TrialUser } from '../mocks/types';
import { profileComplete } from '../mocks/domain/auth';
import { createMockAuthService, type AuthResult } from '../mocks/services/authService';
import { devKey, readJSON, trialKey, writeJSON } from '../mocks/storage';

/**
 * 누가 어떤 자격으로 앱을 보고 있는지(0010).
 *  - `trial`: 신규 체험 사용자.
 *  - `review`: 기존 민준·서연 예시 검토 모드.
 *  - 없으면(익명) 시작 화면으로 보낸다.
 *
 * 세션이 바뀌는 모든 동작(가입·로그인·로그아웃·리뷰 모드 진입·계정/시점 전환)은 `sessionGen`을
 * 올린다. 비동기 작업은 시작 시 세대를 캡처하고, 끝났을 때 세대가 달라졌으면 결과를 버린다 —
 * 로그아웃 뒤 도착한 늦은 가입·로그인·연결 결과가 새 세션에 새지 않게 한다.
 */
export type ReviewAccountId = 'user-minjun' | 'user-seoyeon';
export type Session =
  { kind: 'trial'; userId: string } | { kind: 'review'; accountId: ReviewAccountId };

export type SessionStatus =
  'anonymous' | 'trial-incomplete' | 'trial-unconnected' | 'trial-connected' | 'review';

const authService = createMockAuthService();
const SESSION_KEY = trialKey('session');
const SCENARIO_KEY = devKey('scenario');

/** 로그인 상태별로 처음 보내야 할 경로. */
export function landingPathFor(status: SessionStatus): string {
  switch (status) {
    case 'trial-incomplete':
      return '/onboarding/profile';
    case 'trial-unconnected':
      return '/connect';
    case 'trial-connected':
    case 'review':
      return '/app/home';
    default:
      return '/';
  }
}

interface SessionContextValue {
  session: Session | null;
  status: SessionStatus;
  trialUser: TrialUser | null;
  /** 세션 세대 — 늦은 비동기 결과를 무효화할 때 비교한다. */
  sessionGen: number;
  currentGen: () => number;
  signUp: (input: { email: string; password: string }) => Promise<AuthResult>;
  logIn: (input: { email: string; password: string }) => Promise<AuthResult>;
  requestPasswordReset: (input: { email: string }) => Promise<{ ok: boolean; message: string }>;
  logOut: () => void;
  enterReviewMode: (accountId: ReviewAccountId) => void;
  switchReviewAccount: (accountId: ReviewAccountId) => void;
  switchTrialPerspective: (userId: string) => void;
  refreshTrialUser: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function trialUserFor(session: Session | null): TrialUser | null {
  if (session?.kind !== 'trial') return null;
  return authService.getUser(session.userId) ?? null;
}

function deriveStatus(session: Session | null, user: TrialUser | null): SessionStatus {
  if (!session) return 'anonymous';
  if (session.kind === 'review') return 'review';
  if (!user) return 'anonymous'; // 세션은 있는데 사용자가 사라짐(초기화 등)
  if (!profileComplete(user.nickname)) return 'trial-incomplete';
  if (!user.coupleId) return 'trial-unconnected';
  return 'trial-connected';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSessionState] = useState<Session | null>(() =>
    readJSON<Session | null>(SESSION_KEY, null),
  );
  const [trialUser, setTrialUser] = useState<TrialUser | null>(() => trialUserFor(session));

  const genRef = useRef(0);
  const [sessionGen, setSessionGen] = useState(0);

  const applySession = useCallback((next: Session | null) => {
    if (next) writeJSON(SESSION_KEY, next);
    else {
      try {
        window.localStorage.removeItem(SESSION_KEY);
      } catch {
        // 접근이 막힌 환경에서는 무시
      }
    }
    setSessionState(next);
    setTrialUser(trialUserFor(next));
    genRef.current += 1;
    setSessionGen(genRef.current);
  }, []);

  const currentGen = useCallback(() => genRef.current, []);

  const signUp = useCallback<SessionContextValue['signUp']>(
    async (input) => {
      const gen = genRef.current;
      const result = await authService.signUp(input);
      if (genRef.current !== gen) return result; // 세션이 바뀜 — 결과를 반영하지 않는다
      if (result.ok) applySession({ kind: 'trial', userId: result.userId });
      return result;
    },
    [applySession],
  );

  const logIn = useCallback<SessionContextValue['logIn']>(
    async (input) => {
      const gen = genRef.current;
      const result = await authService.logIn(input);
      if (genRef.current !== gen) return result;
      if (result.ok) applySession({ kind: 'trial', userId: result.userId });
      return result;
    },
    [applySession],
  );

  const requestPasswordReset = useCallback<SessionContextValue['requestPasswordReset']>(
    async (input) => {
      const gen = genRef.current;
      const result = await authService.requestPasswordReset(input);
      if (genRef.current !== gen) return { ok: false, message: '' };
      return result;
    },
    [],
  );

  const logOut = useCallback(() => {
    if (!window.confirm('로그아웃하면 작성 중이던 내용이 사라져요.')) return;
    applySession(null);
    writeJSON(SCENARIO_KEY, 'happy-path');
    navigate('/', { replace: true });
  }, [applySession, navigate]);

  const enterReviewMode = useCallback(
    (accountId: ReviewAccountId) => {
      applySession({ kind: 'review', accountId });
      navigate('/app/home', { replace: true });
    },
    [applySession, navigate],
  );

  const switchReviewAccount = useCallback(
    (accountId: ReviewAccountId) => applySession({ kind: 'review', accountId }),
    [applySession],
  );

  const switchTrialPerspective = useCallback(
    (userId: string) => applySession({ kind: 'trial', userId }),
    [applySession],
  );

  const refreshTrialUser = useCallback(() => {
    setTrialUser(trialUserFor(session));
  }, [session]);

  const status = deriveStatus(session, trialUser);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      status,
      trialUser,
      sessionGen,
      currentGen,
      signUp,
      logIn,
      requestPasswordReset,
      logOut,
      enterReviewMode,
      switchReviewAccount,
      switchTrialPerspective,
      refreshTrialUser,
    }),
    [
      session,
      status,
      trialUser,
      sessionGen,
      currentGen,
      signUp,
      logIn,
      requestPasswordReset,
      logOut,
      enterReviewMode,
      switchReviewAccount,
      switchTrialPerspective,
      refreshTrialUser,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession은 SessionProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
