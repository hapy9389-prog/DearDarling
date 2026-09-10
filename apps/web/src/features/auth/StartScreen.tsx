import { useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';

/** 앱의 첫 화면(0010). 가입·로그인, 그리고 민준·서연 예시 검토 모드 진입. */
export function StartScreen() {
  const navigate = useNavigate();
  const { enterReviewMode } = useSession();

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="font-display text-3xl text-ink">DearDarling</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          연결된 두 사람의 대화에서
          <br />
          필요한 순간 AI가 소통을 돕는 관계 코칭 메신저
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate('/signup')}
          className="w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
        >
          함께 시작하기
        </button>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="w-full rounded-full border border-border px-4 py-3 text-sm font-medium text-ink"
        >
          이미 계정이 있어요
        </button>
        <button
          type="button"
          onClick={() => enterReviewMode('user-minjun')}
          className="mt-2 text-center text-xs text-ink-faint underline"
        >
          민준·서연 예시 화면 둘러보기
        </button>
      </div>
    </div>
  );
}
