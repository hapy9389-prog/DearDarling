import { useNavigate } from 'react-router';
import { useState } from 'react';
import { SESSION_EXPIRED_MESSAGE, useSession } from '../../state/SessionContext';
import { ConsentToggle } from '../settings/ConsentToggle';

/**
 * 실제 계정 — AI 분석 동의. 연결 여부와 무관하게 항상 접근 가능하고(가드에서 `RedirectIf
 * RealConnected`를 씌우지 않음), 켜지 않아도 계속 쓸 수 있다(동의를 강제로 켜지 않는다).
 *
 * `realUser.analysisConsent`가 유일한 출처다 — 저장이 200으로 확정된 경우에만
 * `SessionContext`가 이 값을 갱신하므로(낙관적 갱신 없음), 화면은 별도의 로컬 "확정값"을
 * 두지 않고 이 값을 그대로 보여준다. 결과가 미확정(202/503)이면 이 값이 안 바뀌므로 토글이
 * 임의로 꺼진 것처럼 보이지 않는다 — 대신 "다시 확인" 버튼으로 서버 상태를 다시 조회한다.
 * "다시 확인"은 재조회가 실제로 성공했을 때만 미확정 안내를 지운다 — 조회 실패를 성공처럼
 * 넘기거나, 이전 값을 최신 확정값처럼 보여주지 않는다.
 */
export function RealAnalysisConsentScreen() {
  const navigate = useNavigate();
  const { realUser, realSetConsent, refreshRealProfile } = useSession();

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();

  if (!realUser) {
    // 가드(RequireAuth·RequireRealAccount·RequireRealProfileComplete)가 이미 막아 주지만,
    // 방어적으로 값을 불러오지 못한 상태를 false로 확정해 보여주지 않는다.
    return <div className="flex flex-1 items-center justify-center" aria-busy="true" />;
  }

  async function handleToggle(next: boolean) {
    setSaving(true);
    setNotice(undefined);
    const result = await realSetConsent(next);
    setSaving(false);
    if (result.kind === 'ok') return; // realUser.analysisConsent가 이미 갱신됨
    if (result.kind === 'unknown') {
      setNotice('저장 결과를 확인하지 못했어요. 다시 확인해 주세요.');
      return;
    }
    if (result.kind === 'unauthenticated') {
      navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
      return;
    }
    if (result.kind === 'rate-limited') {
      setNotice('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (result.kind === 'network-error') {
      setNotice('연결에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
      return;
    }
    setNotice(result.message);
  }

  /** 재조회가 실제로 성공했을 때만 미확정 안내를 지운다 — 실패는 성공처럼 넘기지 않고,
   * 조회에 실패한 동안에는 이전 값을 "최신 확정값"인 것처럼 안내하지 않는다(그대로 두되
   * 안내 문구만 실패 사유에 맞게 구체화한다). */
  async function handleRecheck() {
    setSaving(true);
    const result = await refreshRealProfile();
    setSaving(false);
    if (result.kind === 'ok') {
      setNotice(undefined); // 서버가 방금 확인해 준 값(realUser.analysisConsent)을 그대로 보여준다
      return;
    }
    if (result.kind === 'stale') return; // 그사이 세션이 바뀌어 이 화면과 무관해짐 — 조용히 무시
    if (result.kind === 'unauthenticated') {
      navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
      return;
    }
    if (result.kind === 'rate-limited') {
      setNotice('요청이 많습니다. 잠시 후 다시 확인해 주세요.');
      return;
    }
    if (result.kind === 'network-error') {
      setNotice('연결에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 확인해 주세요.');
      return;
    }
    setNotice('동의 상태를 확인하지 못했어요. 다시 확인해 주세요.');
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">AI 분석 동의</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        선택 사항이에요. 두 사람이 모두 동의해야 커플 분석(코칭·주간 리포트)이 시작돼요. 지금 정하지
        않아도 나중에 다시 바꿀 수 있어요.
      </p>

      <div className="mt-6">
        <ConsentToggle
          value={realUser.analysisConsent}
          onChange={(next) => void handleToggle(next)}
          disabled={saving}
        />
      </div>

      {notice && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-ink-soft">{notice}</p>
          <button
            type="button"
            onClick={() => void handleRecheck()}
            disabled={saving}
            className="w-full rounded-full border border-border px-3 py-2 text-xs font-medium text-ink disabled:opacity-60"
          >
            다시 확인
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate('/real/home')}
          className="w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
        >
          {realUser.analysisConsent ? '완료' : '나중에 정하고 계속하기'}
        </button>
      </div>
    </div>
  );
}
