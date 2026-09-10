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
