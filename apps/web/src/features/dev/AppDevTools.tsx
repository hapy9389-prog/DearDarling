import { createPortal } from 'react-dom';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { SCENARIO_OPTIONS, useScenario } from '../../state/ScenarioContext';
import { usePatterns } from '../../state/PatternContext';
import { useMemories } from '../../state/MemoriesContext';
import { Divider } from './DevPanel';
import { useDevPanelSlot } from './devPanelSlot';

/**
 * `/app` 안에서만 의미 있는 검토 레버(0010). `AppShell`이 렌더하고, DevPanel이 연 오버레이의
 * 슬롯으로 포털한다. `/app` 밖에서는 마운트되지 않으므로 전역 DevPanel과 분리된다.
 */
export function AppDevTools() {
  const { element, open } = useDevPanelSlot();
  const { mode } = useActiveAccount();
  const { scenario, setScenario } = useScenario();
  const { weeklyFindingsPresent, setWeeklyFindingsPresent } = usePatterns();
  const {
    suggestionsPresent,
    rememberWhenEnabled,
    setSuggestionsPresent,
    setRememberWhenEnabled,
    refillSeedMemories,
  } = useMemories();

  if (!open || !element) return null;

  const reviewOnly = mode === 'review';

  return createPortal(
    <>
      <Divider />
      <section>
        <h2 className="eyebrow mb-2 text-ink-soft">화면 상태 시나리오</h2>
        <div className="flex flex-col gap-2">
          {SCENARIO_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setScenario(opt.id)}
              className={`rounded-xl border px-3 py-2 text-left text-sm ${
                opt.id === scenario
                  ? 'border-coaching bg-coaching-soft text-coaching'
                  : 'border-border text-ink-soft'
              }`}
            >
              <span className="block font-medium text-ink">{opt.label}</span>
              <span className="block text-xs text-ink-soft">{opt.description}</span>
            </button>
          ))}
        </div>
      </section>

      {reviewOnly && (
        <>
          <Divider />
          <section>
            <h2 className="eyebrow mb-2 text-ink-soft">주간 리포트 · 이번 주 발견</h2>
            <div className="flex gap-2">
              {[
                { present: true, label: '이번 주 발견 있음' },
                { present: false, label: '이번 주 발견 없음' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setWeeklyFindingsPresent(opt.present)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                    opt.present === weeklyFindingsPresent
                      ? 'border-coaching bg-coaching-soft text-coaching'
                      : 'border-border text-ink-soft'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <Divider />
          <section>
            <h2 className="eyebrow mb-2 text-ink-soft">추억 · 화면 검토</h2>
            <div className="flex gap-2">
              {[
                { present: true, label: 'AI 발견 켬' },
                { present: false, label: 'AI 발견 끔' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  aria-label={`AI 발견 순간 ${opt.present ? '켬' : '끔'}`}
                  onClick={() => setSuggestionsPresent(opt.present)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                    opt.present === suggestionsPresent
                      ? 'border-coaching bg-coaching-soft text-coaching'
                      : 'border-border text-ink-soft'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {[
                { enabled: true, label: '그때의 우리 켬' },
                { enabled: false, label: '그때의 우리 끔' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  aria-label={`그때의 우리 리마인드 ${opt.enabled ? '켬' : '끔'}`}
                  onClick={() => setRememberWhenEnabled(opt.enabled)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                    opt.enabled === rememberWhenEnabled
                      ? 'border-coaching bg-coaching-soft text-coaching'
                      : 'border-border text-ink-soft'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refillSeedMemories}
              className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm text-ink-soft"
            >
              예시 추억 채우기
            </button>
          </section>
        </>
      )}
    </>,
    element,
  );
}
