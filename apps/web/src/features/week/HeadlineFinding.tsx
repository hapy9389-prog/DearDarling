import { useState } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { coachingExclusionNote, isExcludedFromCoaching } from '../../mocks/domain/patterns';
import type { PatternObservation } from '../../mocks/types';
import { EvidenceQuotes, ObservationControls } from './PatternObservationCard';

/**
 * 이번 주 대표 발견 하나(docs/decisions/0007). 자연스러운 제목 + 흐름 도식 + 관찰한 모습(사실) +
 * AI 해석(최대 2문단) + 근거 인용 + 작은 실천 하나로 구성한다. 제목·도식·본문이 서로 내용을
 * 반복하지 않게 짧게 유지한다.
 *
 * - 관찰 사실(observation)과 AI 해석(interpretation)을 화면에서 분리한다. 상대의 속마음·성격은
 *   단정하지 않는다. '전문가 검토' 같은 표현은 쓰지 않는다 — 근거와 글로 신뢰를 준다.
 * - 코칭 활용이 중단되면 '작은 실천 하나'를 숨기고 부드러운 안내로 대체한다. 해석글에 같은
 *   조언을 넣어 제외를 우회하지 않는다(시드 데이터에서 지킨다).
 * - 의견·코칭 제외 조작과 그 범위 안내는 '자세히 보기' 펼침 영역(`ObservationControls`)에 둔다.
 * - 예전에 저장된 관찰이 대표로 와서 title/interpretation/flow가 없어도 깨지지 않는다.
 */
export function HeadlineFinding({ observation }: { observation: PatternObservation }) {
  const { account } = useActiveAccount();
  const excluded = isExcludedFromCoaching(observation);
  const exclusionNote = coachingExclusionNote(observation);
  const [expanded, setExpanded] = useState(false);

  // 계정을 전환하면 펼침을 접는다 — 새 계정 시점에서 다시 펼쳐 보게 한다(카드와 같은 규칙).
  const [cardAccountId, setCardAccountId] = useState(account.id);
  if (cardAccountId !== account.id) {
    setCardAccountId(account.id);
    setExpanded(false);
  }

  const interpretation = (observation.interpretation ?? []).slice(0, 2);
  const flow = observation.flow ?? [];
  const opinionCount = new Set(observation.opinions.map((opinion) => opinion.authorId)).size;

  return (
    <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
      <p className="eyebrow text-ink-faint">이번 주 눈에 띈 우리 모습</p>
      <h2 className="mt-1 font-display text-lg leading-snug text-ink">
        {observation.title ?? '이번 주 눈에 띈 흐름'}
      </h2>

      {flow.length > 0 && <FlowDiagram steps={flow} />}

      <div className="mt-4">
        <p className="eyebrow mb-1 text-ink-faint">관찰한 모습</p>
        <p className="text-sm leading-relaxed text-ink">{observation.observation}</p>
      </div>

      {interpretation.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1 text-ink-faint">이렇게 이해해 볼 수도 있어요</p>
          <div className="flex flex-col gap-1.5">
            {interpretation.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-relaxed text-ink-soft">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <EvidenceQuotes observation={observation} />
      </div>

      {excluded ? (
        <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-faint">
          {exclusionNote} — 관련 실천 제안은 표시하지 않아요.
        </p>
      ) : (
        <div className="mt-3">
          <p className="eyebrow mb-1 text-ink-faint">작은 실천 하나</p>
          <p className="text-sm leading-relaxed text-coaching">{observation.suggestion}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="mt-3 text-xs font-medium text-accent"
      >
        {expanded
          ? '접기'
          : opinionCount > 0
            ? `의견 남기기·코칭 제외 (의견 ${opinionCount})`
            : '의견 남기기·코칭 제외'}
      </button>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          <ObservationControls observation={observation} />
        </div>
      )}
    </section>
  );
}

/** 발견의 흐름을 라벨만으로 보여주는 작은 도식(장식 사진 아님, 인라인 CSS). */
function FlowDiagram({ steps }: { steps: string[] }) {
  return (
    <div
      className="mt-3 flex items-stretch gap-1.5 overflow-x-auto"
      aria-label={`흐름: ${steps.join(' 다음 ')}`}
    >
      {steps.map((step, index) => (
        <div key={step} className="flex items-center gap-1.5">
          <span className="rounded-lg bg-coaching-soft px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-coaching">
            {step}
          </span>
          {index < steps.length - 1 && (
            <span aria-hidden="true" className="text-xs text-ink-faint">
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
