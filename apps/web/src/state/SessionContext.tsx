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
import * as inviteApi from '../api/inviteApi';
import * as coupleApi from '../api/coupleApi';
import { toRealCouple, type RealCouple } from '../api/coupleApi';
import * as consentApi from '../api/consentApi';

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
  /** 프로필은 완료했지만 아직 커플로 연결되지 않음 — `/real/home`이 안에서 "연결하기" 안내를
   * 보여준다(별도 경로로 리다이렉트하지 않는다 — 기존 의미를 그대로 유지). */
  | 'real-home'
  /** 프로필 완료 + 커플 연결까지 끝남 — `/real/home`으로 가는 건 위와 같지만, `RedirectIfReal
   * Connected` 가드가 `/real/connect`류에서 이 상태만 되돌린다. */
  | 'real-connected';

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
    case 'real-connected':
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
/** 초대 수락 중 5xx를 받았지만 outcome에 message가 없을 때의 대체 문구 — "실패"가 아니라
 * "확인 필요"로 안내한다(성공·실패 어느 쪽도 단정하지 않는다). */
const SERVER_ERROR_MESSAGE = '연결 결과를 확인하지 못했습니다. 다시 확인해 주세요.';
/** 이미 로그인한 세션으로 보호된 API를 부르다가 401을 받았을 때 — 화면이 로그인 화면으로
 * 안내할 때 공통으로 쓰는 문구. */
export const SESSION_EXPIRED_MESSAGE = '로그인이 만료됐습니다. 다시 로그인해 주세요.';

/** 초대 수락 실패 사유 — `apps/api`의 `InviteAcceptReason`과 문자 그대로 일치한다(미리보기·
 * 수락 둘 다 같은 사유를 쓴다). */
export type InviteReason =
  | 'not-found'
  | 'expired'
  | 'revoked'
  | 'already-accepted'
  | 'self'
  | 'accepter-already-connected'
  | 'inviter-already-connected';

const INVITE_REASONS = new Set<string>([
  'not-found',
  'expired',
  'revoked',
  'already-accepted',
  'self',
  'accepter-already-connected',
  'inviter-already-connected',
]);
function isInviteReason(value: string): value is InviteReason {
  return INVITE_REASONS.has(value);
}

export const INVITE_REASON_MESSAGE: Record<InviteReason, string> = {
  'not-found': '유효하지 않은 코드예요.',
  expired: '만료된 코드예요. 상대에게 새 코드를 받아 주세요.',
  revoked: '취소된 코드예요.',
  'already-accepted': '이미 사용된 코드예요.',
  self: '본인 코드예요.',
  'accepter-already-connected': '이미 다른 사람과 연결돼 있어요.',
  'inviter-already-connected': '상대가 이미 다른 사람과 연결돼 있어요.',
};

/** 초대 코드 발급(멱등 — 이미 활성 초대가 있으면 그걸 그대로 돌려준다) 결과. */
export type InviteCreateResult =
  | { kind: 'ok'; code: string; expiresAt: string }
  | { kind: 'already-connected'; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'unauthenticated' }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  | { kind: 'origin-not-allowed'; message: string }
  | { kind: 'server-error'; message: string }
  | { kind: 'rejected'; message: string };

/** 초대 코드 미리보기(로그인 필요, 조회만 — 사용 처리·연결 없음) 결과. */
export type InvitePreviewResult =
  | { kind: 'ok'; nickname: string; avatarEmoji: string }
  | { kind: 'invite-rejected'; reason: InviteReason }
  | { kind: 'unauthenticated' }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  | { kind: 'origin-not-allowed'; message: string }
  | { kind: 'server-error'; message: string }
  | { kind: 'rejected'; message: string };

/** 초대 수락 결과 — 수락 자체의 확정 성공/실패와, 수락 뒤 로컬 정보 반영 실패를 구분한다. */
export type InviteAcceptResult =
  | { kind: 'ok'; coupleId: string }
  /** 수락은 서버에서 확정 성공했다 — 그 뒤 프로필 재조회만 실패했다. "수락 실패"로 표시하지
   * 않는다. 재시도는 조회만 다시 하면 된다(수락 POST를 다시 보내지 않는다). */
  | { kind: 'connected-refresh-failed'; coupleId: string }
  /** 수락 요청 자체의 결과가 미확정(202/503, 또는 응답만 유실됐을 수 있는 네트워크 오류)이고,
   * 재조회로도 연결 여부를 확인하지 못했다. 수락 POST를 무조건 반복하지 않는다 — 재확인
   * (재조회)만 다시 시도할 수 있게 안내한다. */
  | { kind: 'unconfirmed'; message: string }
  | { kind: 'invite-rejected'; reason: InviteReason }
  | { kind: 'invalid-date'; message: string }
  | { kind: 'unauthenticated' }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  | { kind: 'origin-not-allowed'; message: string }
  | { kind: 'server-error'; message: string }
  | { kind: 'rejected'; message: string };

export type InviteRevokeResult =
  | { kind: 'ok' }
  | { kind: 'unauthenticated' }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  | { kind: 'origin-not-allowed'; message: string }
  | { kind: 'server-error'; message: string }
  | { kind: 'rejected'; message: string };

export type CoupleFetchResult =
  | { kind: 'ok'; couple: RealCouple }
  | { kind: 'not-connected' }
  | { kind: 'unauthenticated' }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  | { kind: 'server-error'; message: string }
  | { kind: 'rejected'; message: string };

/** 동의 저장/철회 결과 — 200 확정 성공에서만 로컬 상태(`realUser.analysisConsent`)를
 * 반영한다. 미확정(202/503)이면 로컬 값을 그대로 두고 재확인이 필요함을 알린다. */
export type ConsentSetResult =
  | { kind: 'ok'; granted: boolean }
  | { kind: 'unknown'; message: string }
  | { kind: 'unauthenticated' }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  | { kind: 'origin-not-allowed'; message: string }
  | { kind: 'server-error'; message: string }
  | { kind: 'rejected'; message: string };

/** 프로필 재조회 결과 — 성공·세션 만료·네트워크/서버 오류·(그 사이 세션이 바뀌어) 무효화된
 * 요청을 구분한다. "다시 확인" 류 UI는 이 결과로만 다음 화면을 결정해야 한다(실패를 성공처럼
 * 넘기거나, 이전 값을 최신 확정값처럼 보여주지 않는다). */
export type ProfileRefreshResult =
  | { kind: 'ok'; profile: RealProfile }
  | { kind: 'unauthenticated' }
  | { kind: 'rate-limited' }
  | { kind: 'network-error' }
  | { kind: 'server-error'; message: string }
  /** 조회가 끝나기 전에 세션이 바뀌었다(로그아웃·계정 전환 등) — 이 결과는 이제 아무 화면과도
   * 무관하니 호출부가 조용히 버려야 한다. */
  | { kind: 'stale' };

/** rejected 상태의 outcome에서 origin-not-allowed(403)·서버 오류(5xx)만 공통으로 뽑아낸다 —
 * 초대·커플·동의 API 전부 이 두 경우는 같은 방식으로 안내한다. 둘 다 아니면 null. */
function commonRejectionKind(outcome: {
  status: number;
  error: string;
}): { kind: 'origin-not-allowed'; message: string } | { kind: 'server-error'; message: string } | null {
  if (outcome.status === 403 && outcome.error === 'origin-not-allowed') {
    return {
      kind: 'origin-not-allowed',
      message: '이 주소에서는 요청할 수 없습니다. 접속 주소나 서버 설정을 확인해 주세요.',
    };
  }
  if (outcome.status >= 500) {
    return {
      kind: 'server-error',
      message: '서버에서 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
  return null;
}

/**
 * 초대 수락이 "진행 중"이거나 "결과가 확정되지 않은" 동안의 최소 기록 — 계정(userId)별로
 * localStorage에 남겨 화면 재진입·새로고침에도 복원한다. **비밀번호·인증 코드·토큰은 절대
 * 담지 않는다** — `code`는 초대 코드(공유용, 인증 정보가 아니다)일 뿐이다.
 *  - `accepting`: 요청을 보낸 뒤 응답을 기다리는 동안(요청 도중 새로고침하면 그 응답을 다시
 *    받을 방법이 없으므로, 복원 시에는 `unconfirmed`와 동일하게 다룬다).
 *  - `connected-refresh-failed`: 서버가 연결을 확정 성공시켰지만 그 직후 내 정보 재조회만
 *    실패했다.
 *  - `unconfirmed`: 수락 결과 자체가 미확정이다.
 * 연결이 실제로 확인되거나(coupleId 확인) 서버가 확정 거절하면 이 기록을 지운다 — 그 외의
 * 실패(조회 실패·요청 제한 등)만으로는 지우지 않는다(아래 realAcceptInvite 참고).
 */
export interface PendingInviteAccept {
  code: string;
  relationshipStartDate: string | null;
  phase: 'accepting' | 'connected-refresh-failed' | 'unconfirmed';
}

const PENDING_INVITE_ACCEPT_KEY_PREFIX = 'deardarling:web:v1:pending-invite-accept:';

function pendingInviteAcceptKey(userId: string): string {
  return `${PENDING_INVITE_ACCEPT_KEY_PREFIX}${userId}`;
}

function readPendingInviteAccept(userId: string): PendingInviteAccept | null {
  try {
    const raw = window.localStorage.getItem(pendingInviteAcceptKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { code?: unknown }).code === 'string' &&
      ((parsed as { relationshipStartDate?: unknown }).relationshipStartDate === null ||
        typeof (parsed as { relationshipStartDate?: unknown }).relationshipStartDate === 'string') &&
      ['accepting', 'connected-refresh-failed', 'unconfirmed'].includes(
        (parsed as { phase?: unknown }).phase as string,
      )
    ) {
      return parsed as PendingInviteAccept;
    }
    return null; // 예상 밖 형태 — 신뢰하지 않고 무시한다
  } catch {
    return null;
  }
}

function writePendingInviteAccept(userId: string, record: PendingInviteAccept): void {
  try {
    window.localStorage.setItem(pendingInviteAcceptKey(userId), JSON.stringify(record));
  } catch {
    // 접근이 막힌 환경 — 이 세션 안에서는 화면 상태(반응형 값)로 여전히 동작한다.
  }
}

function clearPendingInviteAcceptStorage(userId: string): void {
  try {
    window.localStorage.removeItem(pendingInviteAcceptKey(userId));
  } catch {
    // 무시
  }
}

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
  refreshRealProfile: () => Promise<ProfileRefreshResult>;
  saveRealProfile: (patch: {
    nickname: string;
    avatarEmoji: string;
  }) => Promise<AuthCallResult>;
  /** 내 초대 코드 발급/조회 — 멱등이라 마운트 시 호출해도 새 코드가 생기지 않는다. */
  realCreateInvite: () => Promise<InviteCreateResult>;
  /** 로그인한 사용자만 호출 가능. 조회만으로 초대를 사용 처리하거나 커플을 연결하지 않는다. */
  realPreviewInvite: (code: string) => Promise<InvitePreviewResult>;
  realAcceptInvite: (input: {
    code: string;
    relationshipStartDate: string | null;
  }) => Promise<InviteAcceptResult>;
  realRevokeInvite: (code: string) => Promise<InviteRevokeResult>;
  realGetCouple: () => Promise<CoupleFetchResult>;
  realSetConsent: (granted: boolean) => Promise<ConsentSetResult>;
  /** 진행 중이거나 결과가 미확정인 초대 수락 기록 — 현재 계정(realUser) 기준으로 복원된다.
   * 없으면 null(수락을 시도한 적이 없거나, 이미 정리됨). */
  pendingInviteAccept: PendingInviteAccept | null;
  /** 재확인 결과 연결이 확인됐거나 더 이상 의미가 없어졌을 때 화면이 직접 정리할 때 쓴다. */
  clearPendingInviteAccept: () => void;
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
    if (!profileComplete(realUser.nickname)) return 'real-incomplete';
    return realUser.coupleId ? 'real-connected' : 'real-home';
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
  // 진행 중이거나 미확정인 초대 수락 기록 — 계정(userId)별로 localStorage에 있으면 그대로
  // 복원한다. 마운트 시점의 로컬 세션 힌트만으로 초기화하고(아직 서버로 확인 전이라도, 이
  // 기록 자체는 "재진입 시 새 시도를 막는" 용도라 서버 확인을 기다릴 필요가 없다), 세션이
  // 바뀔 때마다(로그인·로그아웃·계정 전환) 아래 effect가 그 계정의 것으로 다시 맞춘다.
  const [pendingInviteAccept, setPendingInviteAccept] = useState<PendingInviteAccept | null>(() =>
    session?.kind === 'real' ? readPendingInviteAccept(session.userId) : null,
  );
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
    // 세션이 바뀔 때마다(로그인·로그아웃·다른 계정으로 전환) 그 계정 자신의 초대 수락 기록
    // 으로 다시 맞춘다 — 다른 계정으로 전환됐다고 이전 계정의 기록을 지우거나 반영하지
    // 않는다(각자 자기 userId 키에만 남아 있다). applySession은 세션이 바뀌는 모든 경로가
    // 반드시 거치므로, 여기 한 곳에서만 다시 읽으면 된다.
    setPendingInviteAccept(next?.kind === 'real' ? readPendingInviteAccept(next.userId) : null);
    genRef.current += 1;
    setSessionGen(genRef.current);
  }, []);

  const currentGen = useCallback(() => genRef.current, []);

  const clearPendingInviteAccept = useCallback(() => {
    if (session?.kind === 'real') {
      clearPendingInviteAcceptStorage(session.userId);
      setPendingInviteAccept(null);
    }
  }, [session]);

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

  const refreshRealProfile = useCallback<SessionContextValue['refreshRealProfile']>(async () => {
    const gen = genRef.current;
    const outcome = await profileApi.getProfile();
    // 조회가 끝나기 전에 세션이 바뀌었다(로그아웃·계정 전환 등) — 이 결과는 이제 어떤 화면과도
    // 무관하니 아무 것도 반영하지 않고 조용히 버린다.
    if (genRef.current !== gen) return { kind: 'stale' };
    if (outcome.kind === 'ok') {
      const profile = toRealProfile(outcome.data);
      setRealUser(profile);
      return { kind: 'ok', profile };
    }
    if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
    if (outcome.kind === 'network-error') return { kind: 'network-error' };
    if (outcome.kind === 'unknown') return { kind: 'server-error', message: outcome.message };
    if (outcome.status === 401) {
      // 보호된 API의 401 — 세대가 이미 위에서 확인됐으므로(다른 계정으로 바뀌지 않았음이
      // 확인된 뒤에만 여기 도달한다), 지금 세션을 만료로 확정 처리해도 안전하다.
      applySession(null);
      return { kind: 'unauthenticated' };
    }
    return {
      kind: 'server-error',
      message: outcome.message ?? '프로필을 불러오지 못했어요.',
    };
  }, [applySession]);

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

  const realCreateInvite = useCallback<SessionContextValue['realCreateInvite']>(async () => {
    const gen = genRef.current;
    const outcome = await inviteApi.createInvite();
    if (genRef.current !== gen) return { kind: 'network-error' };
    if (outcome.kind === 'ok') {
      return { kind: 'ok', code: outcome.data.code, expiresAt: outcome.data.expires_at };
    }
    if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
    if (outcome.kind === 'network-error') return { kind: 'network-error' };
    if (outcome.kind === 'unknown') return { kind: 'unknown', message: outcome.message };
    const common = commonRejectionKind(outcome);
    if (common) return common;
    if (outcome.status === 401) {
      applySession(null);
      return { kind: 'unauthenticated' };
    }
    if (outcome.status === 409 && outcome.error === 'inviter-already-connected') {
      return { kind: 'already-connected', message: '이미 연인과 연결돼 있어요.' };
    }
    return { kind: 'rejected', message: outcome.message ?? '초대 코드를 만들지 못했어요.' };
  }, [applySession]);

  const realPreviewInvite = useCallback<SessionContextValue['realPreviewInvite']>(async (code) => {
    const gen = genRef.current;
    const outcome = await inviteApi.previewInvite(code);
    if (genRef.current !== gen) return { kind: 'network-error' };
    if (outcome.kind === 'ok') {
      return {
        kind: 'ok',
        nickname: outcome.data.inviter_nickname ?? '',
        avatarEmoji: outcome.data.inviter_avatar_emoji ?? '',
      };
    }
    if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
    if (outcome.kind === 'network-error') return { kind: 'network-error' };
    // 미리보기는 조회일 뿐이라 미확정 결과를 특별 취급할 이유가 없다 — 다시 조회하면 그만이다.
    if (outcome.kind === 'unknown') return { kind: 'rejected', message: outcome.message };
    const common = commonRejectionKind(outcome);
    if (common) return common;
    if (outcome.status === 401) {
      applySession(null);
      return { kind: 'unauthenticated' };
    }
    if (outcome.status === 409 && isInviteReason(outcome.error)) {
      return { kind: 'invite-rejected', reason: outcome.error };
    }
    return { kind: 'rejected', message: outcome.message ?? '코드를 확인하지 못했어요.' };
  }, [applySession]);

  const realAcceptInvite = useCallback<SessionContextValue['realAcceptInvite']>(
    async ({ code, relationshipStartDate }) => {
      const gen = genRef.current;
      const userId = session?.kind === 'real' ? session.userId : null;

      // localStorage(계정별)는 항상 캡처해 둔 userId에만 쓴다 — 그 사이 다른 계정으로
      // 전환돼도 엉뚱한 계정의 기록을 건드리지 않는다. 화면에 즉시 보이는 반응형 값
      // (pendingInviteAccept)은 세대가 그대로일 때만(=지금도 같은 세션일 때만) 갱신한다.
      const persist = (record: PendingInviteAccept | null) => {
        if (!userId) return;
        if (record) writePendingInviteAccept(userId, record);
        else clearPendingInviteAcceptStorage(userId);
        if (genRef.current === gen) setPendingInviteAccept(record);
      };

      // 요청을 보내기 전에 먼저 기록한다 — 응답을 받기 전에 화면을 떠나거나(재진입) 새로고침
      // 해도 이 기록이 남는다. 비밀번호·인증 코드·토큰은 담지 않는다(code는 초대 코드일 뿐).
      persist({ code, relationshipStartDate, phase: 'accepting' });

      const outcome = await inviteApi.acceptInvite(code, relationshipStartDate);

      // 5xx는 "서버가 요청을 거절했다"는 확정 신호가 아니다 — 미들웨어 단계(요청 제한·
      // Origin 검사·인증)에서 나오는 401·403·429나, 서비스가 입력을 검증한 뒤 명시적으로
      // 돌려주는 400·409와 달리, 5xx는 서버 어디에서든(트랜잭션 도중·커밋 후 응답 작성
      // 중 등) 발생할 수 있는 처리되지 않은 예외의 결과다. 트랜잭션이 실제로 커밋됐는지,
      // 롤백됐는지, 아예 실행되지 않았는지는 500 상태 코드만으로 알 수 없다 — 그래서 이
      // 확정할 수 없는 응답도 unknown/network-error와 동일하게 "미확정"으로 다루고, 실제
      // 연결 여부는 프로필 재조회로만 확인한다. commonRejectionKind는 다른 호출부(생성·
      // 미리보기·취소·동의)의 확정 거절 판단에는 그대로 쓰이므로 여기서는 건드리지 않고,
      // 이 함수 안에서만 5xx를 별도로 먼저 걸러낸다.
      const isAmbiguousOutcome =
        outcome.kind === 'unknown' ||
        outcome.kind === 'network-error' ||
        (outcome.kind === 'rejected' && outcome.status >= 500);

      // 세션이 이미 바뀌었어도(다른 계정으로 전환 등) 이 계정(userId) 자신의 기록에는 실제로
      // 일어난 일을 반영해 둔다 — 완전히 지워 버리면 "실제로는 연결됐다"는 사실을 잃어버린다.
      // 다만 더 이상 이 세션과 무관하므로, 프로필 재조회 같은 후속 네트워크 호출은 하지
      // 않는다(현재 세션의 쿠키로 다른 계정 확인을 시도하게 되기 때문이다). 반환값은 항상
      // network-error로 통일한다 — 어차피 이 화면은 더 이상 이 결과를 쓰지 않는다.
      if (genRef.current !== gen) {
        if (outcome.kind === 'ok') {
          persist({ code, relationshipStartDate, phase: 'connected-refresh-failed' });
        } else if (isAmbiguousOutcome) {
          persist({ code, relationshipStartDate, phase: 'unconfirmed' });
        } else {
          // 확정 거절(또는 확정 거절과 동일하게 다루는 401·403·429, 혹은 입력 자체가 거절된
          // 400·409) — 없었던 일이 됐다. 5xx는 위 isAmbiguousOutcome에서 이미 처리했으므로
          // 여기엔 도달하지 않는다.
          persist(null);
        }
        return { kind: 'network-error' };
      }

      if (outcome.kind === 'ok') {
        // 수락 자체는 서버에서 확정 성공했다 — 이후 프로필 재조회가 실패해도 "수락 실패"로
        // 보고하지 않는다. 재시도는 이 조회만 다시 하면 된다(수락 POST를 반복하지 않는다).
        const check = await refreshRealProfile();
        if (check.kind === 'stale') {
          // 이 확인 도중 세션이 바뀌었다 — 그래도 accept 자체는 이 userId 계정에서 확정
          // 성공했다는 사실은 변하지 않으므로, 그 계정의 기록만은 남겨 둔다(반응형 값은
          // 이미 다른 세션 것이라 건드리지 않는다).
          persist({ code, relationshipStartDate, phase: 'connected-refresh-failed' });
          return { kind: 'network-error' };
        }
        if (check.kind === 'unauthenticated') {
          // 방금 수락은 성공했는데 그 직후 세션이 끊겼다 — "수락 실패"가 아니다. 같은
          // 계정으로 다시 로그인하면 이 기록으로 복원되도록 남겨 둔다.
          persist({ code, relationshipStartDate, phase: 'connected-refresh-failed' });
          return { kind: 'unauthenticated' };
        }
        if (check.kind === 'ok') {
          persist(null); // 연결이 확인됐다 — 기록을 정리한다.
          return { kind: 'ok', coupleId: outcome.data.coupleId };
        }
        persist({ code, relationshipStartDate, phase: 'connected-refresh-failed' });
        return { kind: 'connected-refresh-failed', coupleId: outcome.data.coupleId };
      }

      if (isAmbiguousOutcome) {
        // 수락 요청 자체의 결과를 확정할 수 없다 — 202/503·네트워크 오류뿐 아니라 500 같은
        // 5xx도 "서버에선 실제로 처리(커밋)됐지만 응답만 유실됐거나 실패했을 수 있는" 상황이므로
        // 실패로 단정하지 않는다. HTTP 500을 받았다는 사실만으로 트랜잭션이 롤백됐다고
        // 보고하지 않는다 — POST는 반복하지 않고, 서버의 실제 프로필 상태(coupleId)만
        // 재조회해 확인한다.
        const check = await refreshRealProfile();
        if (check.kind === 'stale') {
          persist({ code, relationshipStartDate, phase: 'unconfirmed' });
          return { kind: 'network-error' };
        }
        if (check.kind === 'unauthenticated') {
          // 원래 수락 결과 자체가 미확정이었는데 재조회마저 세션 만료로 실패했다 — 여전히
          // 아무 것도 확정되지 않았다. 기록은 'unconfirmed'로 남겨 다시 로그인한 뒤 이어서
          // 확인할 수 있게 한다.
          persist({ code, relationshipStartDate, phase: 'unconfirmed' });
          return { kind: 'unauthenticated' };
        }
        if (check.kind === 'ok' && check.profile.coupleId) {
          persist(null); // 연결이 확인됐다 — 기록을 정리한다.
          return { kind: 'ok', coupleId: check.profile.coupleId };
        }
        // 조회 자체가 실패했거나(check.kind !== 'ok'), 조회는 됐지만 아직 연결이 확인되지
        // 않았다 — 둘 다 "미확정"으로 남긴다(성공도 확정 실패도 아니다). 이 한 번의 조회
        // 결과만으로 이전 수락이 실패했다고 확정하지 않는다 — 기록을 그대로 유지한다.
        persist({ code, relationshipStartDate, phase: 'unconfirmed' });
        const message =
          outcome.kind === 'unknown'
            ? outcome.message
            : outcome.kind === 'network-error'
              ? NETWORK_ERROR_MESSAGE
              : (outcome.message ?? SERVER_ERROR_MESSAGE);
        return { kind: 'unconfirmed', message };
      }

      // 아래부터는 서버가 수락 로직을 실행하기도 전에(요청 제한·Origin 검사·인증) 확정적으로
      // 거절했거나, API 계약상 입력을 검증한 뒤 명시적으로 돌려주는 결과(400 날짜 형식·409
      // 사유)다 — 이 경우들만 "이 수락은 처리되지 않았음이 보장"되므로 기록을 정리해 코드
      // 수정·새 시도를 허용한다. 5xx는 위 isAmbiguousOutcome 분기에서 이미 처리돼 여기 도달하지
      // 않는다 — 이 시점부터는 outcome.status가 5xx일 수 없다.
      if (outcome.kind === 'rate-limited') {
        persist(null);
        return { kind: 'rate-limited' };
      }
      const common = commonRejectionKind(outcome);
      if (common) {
        persist(null);
        return common;
      }
      if (outcome.status === 401) {
        persist(null);
        applySession(null);
        return { kind: 'unauthenticated' };
      }
      if (outcome.status === 400 && outcome.error === 'invalid-relationship-start-date') {
        persist(null);
        return { kind: 'invalid-date', message: outcome.message ?? '날짜 형식을 확인해 주세요.' };
      }
      if (outcome.status === 409 && isInviteReason(outcome.error)) {
        persist(null);
        return { kind: 'invite-rejected', reason: outcome.error };
      }
      persist(null);
      return { kind: 'rejected', message: outcome.message ?? '연결하지 못했어요.' };
    },
    [applySession, refreshRealProfile, session],
  );

  const realRevokeInvite = useCallback<SessionContextValue['realRevokeInvite']>(async (code) => {
    const gen = genRef.current;
    const outcome = await inviteApi.revokeInvite(code);
    if (genRef.current !== gen) return { kind: 'network-error' };
    if (outcome.kind === 'ok' && outcome.status === 204) return { kind: 'ok' };
    if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
    if (outcome.kind === 'network-error') return { kind: 'network-error' };
    if (outcome.kind === 'rejected') {
      const common = commonRejectionKind(outcome);
      if (common) return common;
      if (outcome.status === 401) {
        applySession(null);
        return { kind: 'unauthenticated' };
      }
      return { kind: 'rejected', message: outcome.message ?? '취소하지 못했어요.' };
    }
    // 'ok'인데 204가 아니거나 'unknown' — 둘 다 예상 밖 응답이라 완료로 단정하지 않는다.
    return { kind: 'rejected', message: '취소 결과를 확인하지 못했어요.' };
  }, [applySession]);

  const realGetCouple = useCallback<SessionContextValue['realGetCouple']>(async () => {
    const gen = genRef.current;
    const outcome = await coupleApi.getCouple();
    if (genRef.current !== gen) return { kind: 'network-error' };
    if (outcome.kind === 'ok') return { kind: 'ok', couple: toRealCouple(outcome.data) };
    if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
    if (outcome.kind === 'network-error') return { kind: 'network-error' };
    if (outcome.kind === 'unknown') {
      return {
        kind: 'server-error',
        message: outcome.message || '서버에서 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      };
    }
    if (outcome.status === 401) {
      applySession(null);
      return { kind: 'unauthenticated' };
    }
    if (outcome.status === 404 && outcome.error === 'not-connected') return { kind: 'not-connected' };
    if (outcome.status >= 500) {
      return {
        kind: 'server-error',
        message: '서버에서 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      };
    }
    return { kind: 'rejected', message: outcome.message ?? '커플 정보를 불러오지 못했어요.' };
  }, [applySession]);

  const realSetConsent = useCallback<SessionContextValue['realSetConsent']>(
    async (granted) => {
      const gen = genRef.current;
      const outcome = await consentApi.setConsent(granted);
      if (genRef.current !== gen) return { kind: 'network-error' };
      if (outcome.kind === 'ok') {
        // 200 확정 성공에서만 로컬 상태를 반영한다 — 미확정 응답으로는 절대 바꾸지 않는다.
        setRealUser((prev) => (prev ? { ...prev, analysisConsent: granted } : prev));
        return { kind: 'ok', granted };
      }
      if (outcome.kind === 'unknown') return { kind: 'unknown', message: outcome.message };
      if (outcome.kind === 'rate-limited') return { kind: 'rate-limited' };
      if (outcome.kind === 'network-error') return { kind: 'network-error' };
      const common = commonRejectionKind(outcome);
      if (common) return common;
      if (outcome.status === 401) {
        applySession(null);
        return { kind: 'unauthenticated' };
      }
      return { kind: 'rejected', message: outcome.message ?? '동의 설정을 저장하지 못했어요.' };
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
      realCreateInvite,
      realPreviewInvite,
      realAcceptInvite,
      realRevokeInvite,
      realGetCouple,
      realSetConsent,
      pendingInviteAccept,
      clearPendingInviteAccept,
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
      realCreateInvite,
      realPreviewInvite,
      realAcceptInvite,
      realRevokeInvite,
      realGetCouple,
      realSetConsent,
      pendingInviteAccept,
      clearPendingInviteAccept,
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
