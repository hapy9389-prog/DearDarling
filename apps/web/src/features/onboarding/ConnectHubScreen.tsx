import { Navigate, useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { Avatar } from '../../shared/components/Avatar';
import { InviteCodeCard } from './InviteCodeCard';

/**
 * 인증됐지만 아직 연결되지 않은 사용자의 홈(0010).
 * 초대 코드 보내기 / 받은 코드 입력 / 프로필·동의 바로가기 / 나중에 연결 / 로그아웃.
 */
export function ConnectHubScreen() {
  const navigate = useNavigate();
  const { session, status, trialUser, refreshTrialUser, logOut } = useSession();

  if (status === 'trial-connected') {
    return <Navigate to="/app/home" replace />;
  }

  const userId = session?.kind === 'trial' ? session.userId : '';

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">연인 연결</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        두 사람이 연결되면 대화·홈·우리·추억을 함께 쓸 수 있어요. 나중에 연결해도 괜찮아요.
      </p>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-canvas-raised px-4 py-3">
        <Avatar emoji={trialUser?.avatarEmoji ?? '🙂'} size={36} />
        <div className="flex-1">
          <p className="text-sm font-medium text-ink">{trialUser?.nickname || '나'}</p>
          <p className="text-xs text-ink-faint">아직 연결 전이에요</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/onboarding/profile')}
          className="text-xs text-accent underline"
        >
          프로필 수정
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <InviteCodeCard userId={userId} onCheckConnected={refreshTrialUser} />

        <button
          type="button"
          onClick={() => navigate('/connect/join')}
          className="w-full rounded-2xl border border-border bg-canvas-raised px-4 py-3 text-left text-sm font-medium text-ink"
        >
          받은 코드 입력하기
        </button>

        <button
          type="button"
          onClick={() => navigate('/consent')}
          className="w-full rounded-2xl border border-border bg-canvas-raised px-4 py-3 text-left"
        >
          <span className="text-sm font-medium text-ink">AI 분석 동의</span>
          <span className="mt-0.5 block text-xs text-ink-soft">
            선택 사항 · 지금 정하지 않아도 돼요
          </span>
        </button>
      </div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <p className="text-xs text-ink-faint">
          연결은 나중에 해도 돼요 — 이 화면으로 다시 올 수 있어요.
        </p>
        <button type="button" onClick={logOut} className="text-xs text-ink-faint underline">
          로그아웃
        </button>
      </div>
    </div>
  );
}
