import { useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { Avatar } from '../../shared/components/Avatar';

/**
 * 실제 계정의 임시 홈(프로필 저장까지만 연결된 단계). 초대·커플 연결·대화·AI 코칭은 아직 실제
 * API에 연결되지 않았다 — 완료된 것처럼 보이지 않도록 "준비 중"임을 명확히 안내한다.
 */
export function RealHomeScreen() {
  const navigate = useNavigate();
  const { realUser, logOut } = useSession();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      {realUser && <Avatar emoji={realUser.avatarEmoji || '💌'} size={56} />}
      <div>
        <p className="font-display text-xl text-ink">
          {realUser?.nickname ? `${realUser.nickname}님, 환영해요` : '환영해요'}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          연인 초대·연결, 대화, AI 코칭은 아직 준비 중이에요.
          <br />
          지금은 회원가입·로그인·프로필 저장까지 실제 계정으로 이용할 수 있어요.
        </p>
      </div>
      <div className="mt-4 flex w-full flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate('/real/profile')}
          className="w-full rounded-full border border-border px-4 py-3 text-sm font-medium text-ink"
        >
          프로필 수정
        </button>
        <button
          type="button"
          onClick={() => {
            void logOut();
          }}
          className="w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
