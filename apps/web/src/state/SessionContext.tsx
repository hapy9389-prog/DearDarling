import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import * as authApi from '../api/authApi';
import * as profileApi from '../api/profileApi';
import { toRealProfile, type RealProfile } from '../api/profileApi';

/**
 * 누가 어떤 자격으로 앱을 보고 있는지(0010, 이후 실제 계정 연결로 확장).
 *  - `trial`: **가상** 체험 사용자 — 실제 인증 없음, `localStorage`에만 존재한다. 지금은
 *    공개 가입·로그인 화면에서 만들 수 없고, 개발 패널(DevPanel)에서 픽스처를 켤 때만 쓰인다.
 *  - `review`: 기존 민준·서연 예시 검토 모드.
 *  - `real`: 실제 Cognito 계정 — apps/api를 통해 인증하고, 프로필도 실제 DB에 저장된다.
 *    **`trial`의 가짜 사용자 조회·업데이트 함수(`authService`)로 절대 들어가지 않는다** —
 *    이 파일 안에서 `trialUser`/`realUser`는 서로 다른 상태로 완전히 분리해 둔다.
 *
 * 세션이 바뀌는 모든 동작(가입·로그인·로그아웃·리뷰 모드 진입·계정/시점 전환)은 `sessionGen`을
 * 올린다. 비동기 작업은 시작 시 세대를 캡처하고, 끝났을 때 세대가 달라졌으면 결과를 버린다 —
 * 로그아웃 뒤 도착한 늦은 가입·로그인·연결 결과가 새 세션에 새지 않게 한다(real 계정의 실제
 * 네트워크 호출에도 그대로 적용한다).
 */
export type ReviewAccountId = 'user-minjun' | 'user-seoyeon';
export type Session =
  | { kind: 'trial'; userId: string }
  | { kind: 'review'; accountId: ReviewAccountId }
  | { kind: 'real'; userId: string };

export type SessionStatus =
  | 'anonymous'
  | 'trial-incomplete'
  | 'trial-unconnected'
  | 'trial-connected'
  | 'review'
  | 'real-incomplete'
  | 'real-home';

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
    case 'real-incomplete':
      return '/real/profile';
    case 'real-home':
      return '/real/home';
    default:
      return '/';
  }
}

/** 실제 계정 인증 호출의 공통 결과 — 화면이 이 종류로만 분기한다(HTTP 상태를 직접 보지 않는다). */
export type AuthCallResult =
  | { kind: 'ok' }
  | { kind: 'needs-confirmation' }
  | { kind: 'rejected'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  /** 로그인 POST는 성공했는데 그 직후 쿠키가 적용된 상태로 확인되지 않았다(/me가 authenticated:
   * false) — 재시도가 아니라 다시 로그인해야 하는 상황이다(쿠키 차단 가능성 등). */
  | { kind: 'cookie-not-applied'; message: string }
  /** 로그인 POST는 성공했고 쿠키도 적용됐지만(/me: authenticated:true) 그 뒤 확인(프로필 조회
   * 등)이 네트워크·서버 오류로 실패했다 — 로그인을 다시 시도(POST 반복)할 필요 없이
   * `retryRealSessionConfirmation`으로 확인만 다시 하면 된다. */
  | { kind: 'confirmation-failed'; message: string }
  /** 서버가 요청 자체를 거절했다(403 origin-not-allowed) — 입력을 잘못 적은 게 아니라 접속
   * 주소나 서버 쪽 설정(Vite 프록시·ALLOWED_ORIGIN 등)이 맞지 않는 경우다. 계정 존재 여부와
   * 무관하므로 "이메일·비밀번호를 확인하라"는 안내와 구분한다. */
  | { kind: 'origin-not-allowed'; message: string }
  /** 서버가 처리 중 내부 오류로 응답했다(5xx) — 입력 문제가 아니라 서버 쪽 문제다. */
  | { kind: 'server-error'; message: string };

const RATE_LIMITED_MESSAGE = '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
const NETWORK_ERROR_MESSAGE = '연결에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';

interface SessionContextValue {
  session: Session | null;
  status: SessionStatus;
  trialUser: TrialUser | null;
  /** 실제 계정 프로필 — `trialUser`와 절대 섞이지 않는다. */
  realUser: RealProfile | null;
  /** 초기 세션 확인(GET /api/auth/me) 진행 중 — 끝나기 전까지 라우팅을 진행하지 않는다. */
  initializing: boolean;
  /** 초기 세션 확인이 네트워크 오류로 실패했는지 — 재시도 UI를 보여줄 때 쓴다. */
  initError: boolean;
  retryInitialization: () => void;
  /** 세션 세대 — 늦은 비동기 결과를 무효화할 때 비교한다. */
  sessionGen: number;
  currentGen: () => number;
  // 가상 체험(mock) — DevPanel 전용 경로에서만 쓰인다.
  signUp: (input: { email: string; password: string }) => Promise<AuthResult>;
  logIn: (input: { email: string; password: string }) => Promise<AuthResult>;
  requestPasswordReset: (input: { email: string }) => Promise<{ ok: boolean; message: string }>;
  // 실제 계정
  realSignUp: (input: { email: string; password: string }) => Promise<AuthCallResult>;
  realConfirmSignUp: (input: { email: string; code: string }) => Promise<AuthCallResult>;
  realResendConfirmationCode: (input: { email: string }) => Promise<AuthCallResult>;
  realLogIn: (input: { email: string; password: string }) => Promise<AuthCallResult>;
  /** 로그인 POST 성공 뒤 확인(쿠키·프로필)만 실패했을 때 재시도용 — 로그인 POST를 다시
   * 보내지 않는다. */
  retryRealSessionConfirmation: () => Promise<AuthCallResult>;
  realRequestPasswordReset: (input: { email: string }) => Promise<AuthCallResult>;
  realConfirmPasswordReset: (input: {
    email: string;
    code: string;
    newPassword: string;
  }) => Promise<AuthCallResult>;
  refreshRealProfile: () => Promise<void>;
  saveRealProfile: (patch: {
    nickname: string;
    avatarEmoji: string;
  }) => Promise<AuthCallResult>;
  logOut: () => Promise<void>;
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

function deriveStatus(
  session: Session | null,
  trialUser: TrialUser | null,
  realUser: RealProfile | null,
): SessionStatus {
  if (!session) return 'anonymous';
  if (session.kind === 'review') return 'review';
  if (session.kind === 'real') {
    if (!realUser) return 'anonymous'; // 아직 초기 확인/프로필 조회 전 — initializing 가드가 먼저 막는다
    return profileComplete(realUser.nickname) ? 'real-home' : 'real-incomplete';
  }
  if (!trialUser) return 'anonymous'; // 세션은 있는데 사용자가 사라짐(초기화 등)
  if (!profileComplete(trialUser.nickname)) return 'trial-incomplete';
  if (!trialUser.coupleId) return 'trial-unconnected';
  return 'trial-connected';
}

/** authApi.Outcome을 화면 공통 결과로 정리한다 — 엔드포인트마다 다른 의미의 401/202 등을
 * 호출부에서 각각 다르게 다룰 수 있도록, 매핑은 호출부(아래 realXxx 함수들)에서 각각 한다. */
function mapGenericOutcome(
  outcome: Awaited<ReturnType<typeof authApi.signUp>>,
  rejectedMessage: string,
): AuthCallResult {
  if (outcome.kind === 'ok') return { kind: 'ok' };
  if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
  if (outcome.kind === 'network-error') return { kind: 'network-error' };
  if (outcome.kind === 'unknown') return { kind: 'unknown', message: outcome.message };
  return { kind: 'rejected', message: outcome.message ?? rejectedMessage };
}

/** 로그아웃처럼 body가 없는 호출(Outcome<undefined>)의 실패 사유를 사람이 읽을 문구로 바꾼다. */
function messageForFailedOutcome(outcome: { kind: string; message?: string }): string {
  if (outcome.kind === 'network-error') return NETWORK_ERROR_MESSAGE;
  if (outcome.kind === 'rate-limited') return RATE_LIMITED_MESSAGE;
  return outcome.message ?? '요청이 거부됐습니다.';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSessionState] = useState<Session | null>(() =>
    readJSON<Session | null>(SESSION_KEY, null),
  );
  const [trialUser, setTrialUser] = useState<TrialUser | null>(() => trialUserFor(session));
  const [realUser, setRealUser] = useState<RealProfile | null>(null);
  // 명시적으로 trial(체험)·review(검토)를 선택한 상태만 로컬 기록을 그대로 믿고 즉시 렌더링한다
  // — 둘 다 자기 완결적인 로컬 상태라 서버에 물어볼 게 없다. 그 외(기록이 없거나 `real`)는
  // 로컬 기록을 "힌트"로만 쓰고 실제 로그인 여부는 항상 서버 쿠키(GET /api/auth/me) 기준으로
  // 확인한다 — 기록이 없다고 곧바로 익명으로 단정하지 않는다(쿠키만 남아 있을 수 있다).
  const [initializing, setInitializing] = useState(
    () => session === null || session.kind === 'real',
  );
  const [initError, setInitError] = useState(false);

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
    if (next?.kind !== 'real') setRealUser(null);
    genRef.current += 1;
    setSessionGen(genRef.current);
  }, []);

  const currentGen = useCallback(() => genRef.current, []);

  // GET /api/auth/me → 인증돼 있으면 GET /api/profile까지 확인하는 공통 절차. 상태를 직접
  // 바꾸지 않고 결과만 돌려준다 — 호출부(마운트/재시도용 checkRealSession, 로그인 직후 확인용
  // realLogIn/retryRealSessionConfirmation)가 각자 사정에 맞게 반영한다.
  //  - 'ok': 인증 확인 + 프로필까지 확보됨(사용자 id·프로필 전부 서버 응답 기준).
  //  - 'unauthenticated': 쿠키가 없거나 서버가 로그인 안 된 것으로 봄 — 재시도 대상이 아니다.
  //  - 'network-error': /me 또는 프로필 조회가 네트워크·서버 오류(5xx 포함)로 실패 — 재시도 대상.
  type RealSessionCheck =
    | { kind: 'ok'; userId: string; profile: RealProfile }
    | { kind: 'unauthenticated' }
    | { kind: 'network-error' };
  const confirmRealSession = useCallback(async (gen: number): Promise<RealSessionCheck> => {
    const me = await authApi.getSession();
    if (genRef.current !== gen) return { kind: 'network-error' };
    if (!me.ok) return { kind: 'network-error' };
    if (!me.data.authenticated || !me.data.userId) return { kind: 'unauthenticated' };
    const profileResult = await profileApi.getProfile();
    if (genRef.current !== gen) return { kind: 'network-error' };
    if (profileResult.kind === 'ok') {
      return { kind: 'ok', userId: me.data.userId, profile: toRealProfile(profileResult.data) };
    }
    if (profileResult.kind === 'rejected' && profileResult.status === 401) {
      return { kind: 'unauthenticated' };
    }
    // 그 외(네트워크 오류·429·5xx·202 unknown 등)는 전부 "확인 실패, 재시도 가능"으로 뭉뚱그린다
    // — 세션 만료(unauthenticated)와 명확히 구분한다.
    return { kind: 'network-error' };
  }, []);

  // 마운트·재시도 전용: 결과를 initializing/initError/session/realUser에 반영한다. 실패해도
  // initializing은 계속 true로 남겨 둔다(=아직 미해결) — SessionGate가 initError를 보고 재시도
  // 화면을 보여주는 동안, "확인 끝남"으로 착각해 일반 화면을 새지 않게 하기 위해서다.
  const checkRealSession = useCallback(async () => {
    const gen = genRef.current;
    // 이 함수가 effect에서 직접 호출될 때, 첫 await 전의 setState가 effect 본문에서 동기
    // 호출된 것으로 잡히지 않도록 마이크로태스크를 하나 먼저 거친다.
    await Promise.resolve();
    if (genRef.current !== gen) return;
    setInitializing(true);
    setInitError(false);
    const result = await confirmRealSession(gen);
    if (genRef.current !== gen) return;
    if (result.kind === 'ok') {
      applySession({ kind: 'real', userId: result.userId });
      setRealUser(result.profile);
      setInitializing(false);
      setInitError(false);
      return;
    }
    if (result.kind === 'unauthenticated') {
      applySession(null);
      setInitializing(false);
      setInitError(false);
      return;
    }
    // network-error — initializing=true를 유지한 채 initError만 세운다(미해결 상태 지속).
    setInitError(true);
  }, [applySession, confirmRealSession]);

  useEffect(() => {
    // 로컬 기록이 없거나(=서버 쿠키만 남아 있을 수 있음) `real` 힌트가 있을 때만 확인한다 —
    // trial·review는 자기 완결적이라 건드리지 않는다.
    if (session === null || session.kind === 'real') void checkRealSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryInitialization = useCallback(() => {
    void checkRealSession();
  }, [checkRealSession]);

  /** 로그인 화면에서 "재확인"용 — 로그인 POST는 이미 성공했고 확인(위 절차)만 실패했을 때
   * 쓴다. 로그인 POST를 다시 보내지 않는다. */
  const retryRealSessionConfirmation = useCallback(async (): Promise<AuthCallResult> => {
    const gen = genRef.current;
    const result = await confirmRealSession(gen);
    if (genRef.current !== gen) return { kind: 'network-error' };
    if (result.kind === 'ok') {
      applySession({ kind: 'real', userId: result.userId });
      setRealUser(result.profile);
      return { kind: 'ok' };
    }
    if (result.kind === 'unauthenticated') {
      // 서버가 이제 로그인 상태가 아니라고 확인해 줬다 — 남아 있던 로컬 real 세션을 정리한다
      // (예: 로그인한 채로 자기 비밀번호를 재설정해 서버 세션이 무효화된 경우).
      applySession(null);
      return {
        kind: 'cookie-not-applied',
        message: '로그인이 확인되지 않았습니다. 다시 로그인해 주세요.',
      };
    }
    return { kind: 'confirmation-failed', message: '확인에 실패했습니다. 다시 시도해 주세요.' };
  }, [applySession, confirmRealSession]);

  // ── 가상 체험(mock) — DevPanel 전용. 실제 계정과 절대 섞이지 않는다. ──────────────
  const signUp = useCallback<SessionContextValue['signUp']>(
    async (input) => {
      const gen = genRef.current;
      const result = await authService.signUp(input);
      if (genRef.current !== gen) return result;
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

  // ── 실제 계정 ─────────────────────────────────────────────────────────────
  const realSignUp = useCallback<SessionContextValue['realSignUp']>(async ({ email, password }) => {
    const gen = genRef.current;
    const outcome = await authApi.signUp(email, password);
    if (genRef.current !== gen) return { kind: 'network-error' }; // 세션이 바뀜 — 화면은 이미 떠났을 것
    if (outcome.kind === 'ok') return { kind: 'needs-confirmation' };
    if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
    if (outcome.kind === 'network-error') return { kind: 'network-error' };
    if (outcome.kind === 'unknown') return { kind: 'unknown', message: outcome.message };
    if (outcome.status === 403 && outcome.error === 'origin-not-allowed') {
      // 입력을 잘못 적은 게 아니다 — 접속 주소나 서버 설정(개발 환경이라면 Vite 프록시·
      // ALLOWED_ORIGIN 등)이 맞지 않는 경우다. "이메일·비밀번호를 확인하라"는 안내를 주면
      // 사용자가 계속 같은 값을 다시 입력하게 만들 뿐이라 원인이 다르다는 걸 구분해 알린다.
      return {
        kind: 'origin-not-allowed',
        message: '이 주소에서는 가입할 수 없습니다. 접속 주소나 서버 설정을 확인해 주세요.',
      };
    }
    if (outcome.status >= 500) {
      // 서버 쪽 처리 오류(5xx) — 입력 문제가 아니다.
      return {
        kind: 'server-error',
        message: '서버에서 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      };
    }
    // signup-rejected(중복 이메일 등), invalid-email, invalid-password 전부 여기로 온다 —
    // API가 이유를 세분해 주지 않는 것(signup-rejected)은 계정 존재 여부를 알려주지 않기
    // 위해 화면에서도 일부러 뭉뚱그려 안내한다.
    return {
      kind: 'rejected',
      message: outcome.message ?? '가입할 수 없습니다. 이메일과 비밀번호를 확인해 주세요.',
    };
  }, []);

  const realConfirmSignUp = useCallback<SessionContextValue['realConfirmSignUp']>(
    async ({ email, code }) => {
      const gen = genRef.current;
      const outcome = await authApi.confirmSignUp(email, code);
      if (genRef.current !== gen) return { kind: 'network-error' };
      return mapGenericOutcome(outcome, '인증 코드가 올바르지 않습니다.');
    },
    [],
  );

  const realResendConfirmationCode = useCallback<
    SessionContextValue['realResendConfirmationCode']
  >(async ({ email }) => {
    const gen = genRef.current;
    const outcome = await authApi.resendConfirmationCode(email);
    if (genRef.current !== gen) return { kind: 'network-error' };
    return mapGenericOutcome(outcome, '인증 코드를 다시 보내지 못했습니다.');
  }, []);

  const realLogIn = useCallback<SessionContextValue['realLogIn']>(
    async ({ email, password }) => {
      const gen = genRef.current;
      const outcome = await authApi.logIn(email, password);
      if (genRef.current !== gen) return { kind: 'network-error' };
      if (outcome.kind === 'ok') {
        // 로그인 POST 성공 자체를 완료로 보지 않는다 — 쿠키가 실제로 적용됐고(authenticated:true
        // + 유효한 userId) 프로필까지 확인돼야 로그인 완료다. 이 확인은 로그인 POST를 다시
        // 보내지 않는다(재시도는 retryRealSessionConfirmation이 담당).
        const check = await confirmRealSession(gen);
        if (genRef.current !== gen) return { kind: 'network-error' };
        if (check.kind === 'ok') {
          applySession({ kind: 'real', userId: check.userId });
          setRealUser(check.profile);
          return { kind: 'ok' };
        }
        if (check.kind === 'unauthenticated') {
          return {
            kind: 'cookie-not-applied',
            message: '로그인 후 세션이 적용되지 않았습니다. 다시 로그인해 주세요.',
          };
        }
        return {
          kind: 'confirmation-failed',
          message: '로그인 확인에 실패했습니다. 다시 시도해 주세요.',
        };
      }
      if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
      if (outcome.kind === 'network-error') return { kind: 'network-error' };
      if (outcome.kind === 'unknown') return { kind: 'unknown', message: outcome.message };
      if (outcome.error === 'conflict') {
        return { kind: 'conflict', message: outcome.message ?? '다시 로그인해 주세요.' };
      }
      // invalid-credentials(401), invalid-input(400) — 둘 다 "입력을 다시 확인" 성격의 거부다.
      // 이 401은 보호된 API의 세션 만료 401과 다른 의미이므로 여기서 절대 로그아웃 처리하지 않는다.
      return {
        kind: 'rejected',
        message: outcome.message ?? '이메일 또는 비밀번호가 올바르지 않습니다.',
      };
    },
    [applySession, confirmRealSession],
  );

  const realRequestPasswordReset = useCallback<SessionContextValue['realRequestPasswordReset']>(
    async ({ email }) => {
      const gen = genRef.current;
      const outcome = await authApi.requestPasswordReset(email);
      if (genRef.current !== gen) return { kind: 'network-error' };
      return mapGenericOutcome(outcome, '요청을 처리하지 못했습니다.');
    },
    [],
  );

  const realConfirmPasswordReset = useCallback<SessionContextValue['realConfirmPasswordReset']>(
    async ({ email, code, newPassword }) => {
      const gen = genRef.current;
      const outcome = await authApi.confirmForgotPassword(email, code, newPassword);
      if (genRef.current !== gen) return { kind: 'network-error' };
      if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
      if (outcome.kind === 'network-error') return { kind: 'network-error' };
      if (outcome.kind === 'unknown') return { kind: 'unknown', message: outcome.message };
      if (outcome.kind === 'rejected') {
        // invalid-code(401), invalid-input/invalid-password(400) — 입력 오류.
        return { kind: 'rejected', message: outcome.message ?? '인증 코드가 올바르지 않습니다.' };
      }
      // 200 — status가 'confirmed' | 'confirmed-local-pending' | 'assumed' 등일 수 있다. 전부
      // "비밀번호는 바뀌었다"는 뜻이라 성공으로 다루되, 서버가 준 안내 문구를 그대로 보여준다
      // (다른 세션 정리가 아직 끝나지 않았을 수 있다는 문구가 포함될 수 있음).
      return outcome.data.message
        ? { kind: 'unknown', message: outcome.data.message } // 문구가 있으면 그대로 보여주고 재로그인 유도
        : { kind: 'ok' };
    },
    [],
  );

  const refreshRealProfile = useCallback(async () => {
    const gen = genRef.current;
    const result = await profileApi.getProfile();
    if (genRef.current !== gen) return;
    if (result.kind === 'ok') setRealUser(toRealProfile(result.data));
  }, []);

  const saveRealProfile = useCallback<SessionContextValue['saveRealProfile']>(
    async ({ nickname, avatarEmoji }) => {
      const gen = genRef.current;
      const outcome = await profileApi.updateProfile({ nickname, avatarEmoji });
      if (genRef.current !== gen) return { kind: 'network-error' };
      if (outcome.kind === 'ok') {
        setRealUser(toRealProfile(outcome.data));
        return { kind: 'ok' };
      }
      if (outcome.kind === 'network-error') return { kind: 'network-error' };
      if (outcome.kind === 'unknown') return { kind: 'unknown', message: outcome.message };
      if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
      if (outcome.status === 401) {
        // 보호된 API의 401 — 여기서만 세션 만료로 다룬다(로그인 401과 다른 의미).
        applySession(null);
        return { kind: 'rejected', message: '로그인이 만료됐습니다. 다시 로그인해 주세요.' };
      }
      return {
        kind: 'rejected',
        message: outcome.message ?? '닉네임을 확인해 주세요.',
      };
    },
    [applySession],
  );

  const logOut = useCallback(async () => {
    if (!window.confirm('로그아웃하면 작성 중이던 내용이 사라져요.')) return;
    if (session?.kind === 'real') {
      const gen = genRef.current;
      const result = await authApi.logOut();
      if (genRef.current !== gen) return; // 그사이 이미 다른 세션으로 바뀜
      // 정상 204만 완료로 본다. 이미 만료된 세션의 401도 "어차피 로그아웃된 상태"라 완료로
      // 본다. 그 외(403·429·5xx·202 unknown·네트워크 오류)는 로그아웃 성공으로 단정하지
      // 않는다 — 로컬 상태를 그대로 두고 실패를 알린 뒤 되돌아간다(시작 화면으로 안 보낸다).
      const success = result.kind === 'ok' && result.status === 204;
      const alreadyLoggedOut = result.kind === 'rejected' && result.status === 401;
      if (!success && !alreadyLoggedOut) {
        window.alert(`로그아웃에 실패했습니다: ${messageForFailedOutcome(result)}`);
        return;
      }
    }
    applySession(null);
    writeJSON(SCENARIO_KEY, 'happy-path');
    navigate('/', { replace: true });
  }, [applySession, navigate, session]);

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

  const status = deriveStatus(session, trialUser, realUser);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      status,
      trialUser,
      realUser,
      initializing,
      initError,
      retryInitialization,
      sessionGen,
      currentGen,
      signUp,
      logIn,
      requestPasswordReset,
      realSignUp,
      realConfirmSignUp,
      realResendConfirmationCode,
      realLogIn,
      retryRealSessionConfirmation,
      realRequestPasswordReset,
      realConfirmPasswordReset,
      refreshRealProfile,
      saveRealProfile,
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
      realUser,
      initializing,
      initError,
      retryInitialization,
      sessionGen,
      currentGen,
      signUp,
      logIn,
      requestPasswordReset,
      realSignUp,
      realConfirmSignUp,
      realResendConfirmationCode,
      realLogIn,
      retryRealSessionConfirmation,
      realRequestPasswordReset,
      realConfirmPasswordReset,
      refreshRealProfile,
      saveRealProfile,
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

/** 화면에서 AuthCallResult를 사용자 문구 하나로 바꿀 때 쓴다(성공류는 빈 문자열). */
export function messageForAuthResult(result: AuthCallResult): string {
  switch (result.kind) {
    case 'ok':
    case 'needs-confirmation':
      return '';
    case 'rejected':
    case 'conflict':
    case 'unknown':
    case 'cookie-not-applied':
    case 'confirmation-failed':
    case 'origin-not-allowed':
    case 'server-error':
      return result.message;
    case 'rate-limited':
      return RATE_LIMITED_MESSAGE;
    case 'network-error':
      return NETWORK_ERROR_MESSAGE;
  }
}
