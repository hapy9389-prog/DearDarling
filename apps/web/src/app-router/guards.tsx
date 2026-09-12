import { Navigate, Outlet } from 'react-router';
import { landingPathFor, useSession } from '../state/SessionContext';

/** 로그인 안 했으면 시작 화면으로. */
export function RequireAuth() {
  const { status } = useSession();
  if (status === 'anonymous') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** 체험 사용자인데 닉네임을 아직 안 정했으면 프로필 화면으로. */
export function RequireProfileComplete() {
  const { status } = useSession();
  if (status === 'trial-incomplete') return <Navigate to="/onboarding/profile" replace />;
  return <Outlet />;
}

/** 아직 연결 전이면 연결 허브로. review·trial-connected는 통과. */
export function RequireConnected() {
  const { status } = useSession();
  if (status === 'trial-unconnected') return <Navigate to="/connect" replace />;
  return <Outlet />;
}

/** 이미 연결된(또는 검토 모드) 사용자는 연결·동의 화면 대신 홈으로. */
export function RedirectIfConnected() {
  const { status } = useSession();
  if (status === 'review' || status === 'trial-connected') {
    return <Navigate to="/app/home" replace />;
  }
  return <Outlet />;
}

/** 이미 로그인했으면 시작·가입·로그인 화면 대신 상태에 맞는 다음 화면으로. */
export function RedirectIfAuthed() {
  const { status } = useSession();
  if (status !== 'anonymous') return <Navigate to={landingPathFor(status)} replace />;
  return <Outlet />;
}

/**
 * 실제 계정(`kind: 'real'`)은 mock(가상) 초대·동의·`/app/*`(가상 커플 데이터를 전제로 하는
 * 화면)로 들어갈 수 없다 — 실제 계정용 초대·커플·동의는 `/real/*` 아래 별도 화면으로만 연결돼
 * 있다(`RequireRealAccount` 참고). 연결됐어도(coupleId 있어도) 예외 없이 `/real/*`로 되돌린다.
 * 직접 URL 접근도 막는다.
 */
export function BlockRealAccounts() {
  const { session, status } = useSession();
  if (session?.kind === 'real') return <Navigate to={landingPathFor(status)} replace />;
  return <Outlet />;
}

/** `/real/*`는 실제 계정 전용이다 — trial·review가 URL로 들어오면 자기 영역으로 돌려보낸다. */
export function RequireRealAccount() {
  const { session, status } = useSession();
  if (session?.kind !== 'real') return <Navigate to={landingPathFor(status)} replace />;
  return <Outlet />;
}

/** 실제 계정인데 닉네임을 아직 안 정했으면 프로필 화면으로 — `RequireProfileComplete`의
 * real 버전. `/real/connect`류·`/real/consent`가 이 아래에 물려 있어야 한다. */
export function RequireRealProfileComplete() {
  const { status } = useSession();
  if (status === 'real-incomplete') return <Navigate to="/real/profile" replace />;
  return <Outlet />;
}

/** 이미 커플로 연결된 실제 계정은 `/real/connect`·`/real/connect/join`(초대 만들기/받기)
 * 대신 홈으로 되돌린다. `/real/consent`는 연결 여부와 무관하게 계속 접근 가능해야 하므로(동의는
 * 언제든 저장·철회할 수 있어야 한다) 이 가드 아래 두지 않는다. */
export function RedirectIfRealConnected() {
  const { status } = useSession();
  if (status === 'real-connected') return <Navigate to="/real/home" replace />;
  return <Outlet />;
}
