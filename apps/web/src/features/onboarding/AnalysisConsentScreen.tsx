import { useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { useMyConsent } from '../../hooks/useMyConsent';
import { ConsentToggle } from '../settings/ConsentToggle';

/**
 * AI 분석 동의(0010) — 가입과 분리된 선택 단계. 기본 꺼짐, 건너뛰어도 연결·대화에 지장 없다.
 * 연결 전이라 상대 없이 "내 동의"만 다룬다(연결 후에는 설정 화면에서 관리).
 */
export function AnalysisConsentScreen() {
  const navigate = useNavigate();
  const { session } = useSession();
  const userId = session?.kind === 'trial' ? session.userId : '';
  const { analysisConsent, setAnalysisConsent } = useMyConsent(userId);

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">AI 분석 동의</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        선택 사항이에요. 두 사람이 모두 동의해야 커플 분석(코칭·주간 리포트)이 시작돼요. 지금 정하지
        않아도 나중에 설정에서 바꿀 수 있어요.
      </p>

      <div className="mt-6">
        <ConsentToggle value={analysisConsent} onChange={setAnalysisConsent} />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate('/connect')}
          className="w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
        >
          {analysisConsent ? '동의하고 계속하기' : '나중에 정하고 계속하기'}
        </button>
      </div>
    </div>
  );
}
