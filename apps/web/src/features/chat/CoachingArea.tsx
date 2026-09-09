import { useEffect, useState } from 'react';
import type { CoachingAreaState } from './chatTypes';

/**
 * 대화 화면의 시그니처 요소. 챗봇 말풍선이 아니라 "곁에서 살짝 건네는 메모"처럼 보이도록,
 * 왼쪽 바이올렛 선 + 세리프 인사이트 문장으로 대화 목록과는 다른 목소리임을 표시한다.
 * 접힌 상태에서는 목록 위에 얇은 줄로만 존재하고, 펼쳐도 목록 자리를 밀어낼 뿐 덮지 않는다.
 */
export function CoachingArea({
  state,
  onSelectSuggestion,
  onHighlightEvidence,
}: {
  state: CoachingAreaState;
  onSelectSuggestion: (text: string) => void;
  onHighlightEvidence: (ids: string[]) => void;
}) {
  if (state.kind === 'loading' || state.kind === 'idle') return null;

  if (state.kind === 'warming-up') {
    return (
      <InfoBar tone="neutral" icon="⏳">
        AI가 아직 대화를 살펴보고 있어요. 잠시 후 다시 확인해 주세요.
      </InfoBar>
    );
  }

  if (state.kind === 'failure') {
    return (
      <InfoBar tone="danger" icon="⚠️">
        지금은 대화 도움을 잠시 사용할 수 없어요.
      </InfoBar>
    );
  }

  if (state.kind === 'consent-pending') {
    return (
      <InfoBar tone="coaching" icon="🔒">
        {state.reason === 'self'
          ? 'AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'
          : '상대방의 AI 분석 동의를 기다리고 있어요.'}
      </InfoBar>
    );
  }

  if (state.kind === 'hidden') {
    return (
      <InfoBar tone="muted" icon="🙈">
        코칭 카드를 숨겨두었어요. 분석은 계속되고 있어요.
      </InfoBar>
    );
  }

  return (
    <ReadyCoachingCard
      insight={state.suggestion.insight}
      evidenceText={state.suggestion.evidenceText}
      alternatives={state.suggestion.alternatives}
      evidenceMessageIds={state.suggestion.evidenceMessageIds}
      onSelectSuggestion={onSelectSuggestion}
      onHighlightEvidence={onHighlightEvidence}
    />
  );
}

function InfoBar({
  tone,
  icon,
  children,
}: {
  tone: 'neutral' | 'danger' | 'coaching' | 'muted';
  icon: string;
  children: string;
}) {
  const toneClass = {
    neutral: 'bg-canvas-raised border-border text-ink-soft',
    danger: 'bg-danger-soft border-danger-soft text-danger',
    coaching: 'bg-coaching-soft border-coaching-border text-coaching',
    muted: 'bg-canvas-raised border-border text-ink-faint',
  }[tone];

  return (
    <div className={`flex items-center gap-2 border-b px-4 py-2 text-xs ${toneClass}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function ReadyCoachingCard({
  insight,
  evidenceText,
  alternatives,
  evidenceMessageIds,
  onSelectSuggestion,
  onHighlightEvidence,
}: {
  insight: string;
  evidenceText: string;
  alternatives: string[];
  evidenceMessageIds: string[];
  onSelectSuggestion: (text: string) => void;
  onHighlightEvidence: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    onHighlightEvidence(expanded ? evidenceMessageIds : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex w-full items-center gap-2 border-b border-coaching-border bg-coaching-soft px-4 py-2 text-left text-coaching"
      >
        <span aria-hidden="true">✦</span>
        <span className="eyebrow">AI 코칭</span>
        <span className="flex-1 truncate text-xs text-ink-soft">새로운 대화 힌트가 있어요</span>
        <span aria-hidden="true">﹀</span>
      </button>
    );
  }

  return (
    <div className="border-b border-coaching-border bg-coaching-soft px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow flex items-center gap-1.5 text-coaching">
          <span aria-hidden="true">✦</span> AI 코칭
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="코칭 카드 접기"
          className="text-ink-faint"
        >
          ✕
        </button>
      </div>

      <p className="font-display text-base leading-snug text-ink italic">{insight}</p>

      <p className="mt-2 text-xs text-ink-soft">
        근거: <span className="italic">{evidenceText}</span>
      </p>

      {alternatives.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {alternatives.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => onSelectSuggestion(text)}
              className="rounded-xl border border-coaching-border bg-canvas-raised px-3 py-2 text-left text-sm text-ink"
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
