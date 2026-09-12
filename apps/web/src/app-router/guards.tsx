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
 * 실제 계정(`kind: 'real'`)은 초대·동의·`/app/*`(가상 커플 데이터를 전제로 하는 화면)로 들어갈
 * 수 없다 — 이번 범위는 프로필까지다. 프로필에 이미 coupleId가 들어 있어도(다음 단계 연결 이후)
 * 예외 없이 `/real/*`로 되돌린다. 직접 URL 접근도 막는다.
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
