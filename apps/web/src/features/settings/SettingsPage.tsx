import type { ReactNode } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useSettings } from '../../state/SettingsContext';
import { useNavigation } from '../../state/NavigationContext';

/**
 * 설정 — 홈 상단 ⚙️로 진입하는 하위 화면(0003). 검토 도구(DevPanel)에 임시로 있던
 * AI 분석 동의·코칭 카드 표시 토글을 여기로 옮겼다.
 * 분석 철회(커플 전체 분석 중단)와 개인 코칭 숨기기(내 화면 표시 설정)는 다른 동작이라 화면에서 구분해 안내한다.
 */
export function SettingsPage() {
  const { navigate } = useNavigation();
  const { account, partner } = useActiveAccount();
  const { mine, partner: partnerSettings, coupleAnalysisActive, updateMine } = useSettings();

  return (
    <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-border bg-canvas-raised px-2 py-3">
        <button
          type="button"
          onClick={() => navigate('home')}
          aria-label="홈으로"
          className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
        >
          <span aria-hidden="true">←</span>
        </button>
        <div>
          <p className="font-display text-lg leading-tight">설정</p>
          <p className="text-xs text-ink-soft">{account.nickname}님의 설정</p>
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 py-5">
        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
          <p className="eyebrow mb-3 text-ink-faint">AI 분석</p>

          <SettingToggle
            label="AI 분석 동의"
            description="두 사람이 모두 동의한 기간에 나눈 대화를 AI가 살펴보고 코칭·주간 리포트·패턴 관찰에 사용해요. 끄면(분석 철회) 그때부터 새 분석이 멈추고, 두 사람 모두에게 홈 요약·주간 리포트·코칭이 나오지 않아요."
            checked={mine.analysisConsent}
            onChange={(checked) => updateMine({ analysisConsent: checked })}
          />

          <div className="mt-3 rounded-xl bg-canvas px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
            <p>
              {partner.nickname}님: {partnerSettings.analysisConsent ? '동의함' : '동의 안 함'}{' '}
              <span className="text-ink-faint">· 상대의 설정은 바꿀 수 없어요</span>
            </p>
            <p className="mt-1 font-medium text-ink-soft">
              현재 커플 분석:{' '}
              {coupleAnalysisActive
                ? '활성 — 두 사람 모두 동의했어요'
                : '중단 — 한 사람 이상 동의하지 않았어요'}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
          <p className="eyebrow mb-3 text-ink-faint">코칭 표시</p>

          <SettingToggle
            label="코칭 카드 표시"
            description="내 대화 화면에서 코칭 카드를 볼지 정하는 개인 설정이에요. 이걸 꺼도 분석 동의 상태는 바뀌지 않아요 — 분석은 두 사람의 동의가 있을 때만 계속되고, 코칭 카드 표시 여부와는 무관해요."
            checked={mine.coachingVisible}
            onChange={(checked) => updateMine({ coachingVisible: checked })}
          />
        </section>

        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
          <p className="eyebrow mb-3 text-ink-faint">작성 도움</p>

          <SettingToggle
            label="작성 중 표현 도움"
            description="메시지를 쓰는 동안 표현을 다듬도록 돕는 개인 설정이에요. 지금은 지정된 예시 문장에 대해서만 대체 표현을 보여주는 화면 검토용이고, 상대 대화를 분석하지 않아요. 기본은 꺼져 있어요."
            checked={mine.draftHelpEnabled}
            onChange={(checked) => updateMine({ draftHelpEnabled: checked })}
          />
        </section>
      </div>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  badge,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-border p-3 ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-accent"
      />
      <span className="flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {badge && (
            <span className="eyebrow rounded-full bg-pending-soft px-2 py-0.5 text-pending">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">{description}</span>
      </span>
    </label>
  );
}
