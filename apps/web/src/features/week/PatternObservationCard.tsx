import { useState } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { usePatterns } from '../../state/PatternContext';
import {
  coachingExclusionNote,
  hasOptedOut,
  isExcludedFromCoaching,
  opinionSummary,
  ownOpinion,
} from '../../mocks/domain/patterns';
import type { PatternObservation, PatternOpinion } from '../../mocks/types';

/**
 * '다른 발견 보기'에 들어가는 보조 관찰 카드(docs/decisions/0007). 기본은 **관찰 한 줄 + 작은 실천
 * 한 줄 + 자세히 보기**만 보여주고, 공개·적용 범위 안내·근거·의견·코칭 제외 조작은 펼침 영역에 둔다.
 * '미확인 가설' 칩은 쓰지 않는다 — 잠정 안내는 '우리' 탭 상단에서 한 번만 한다. 제외된 카드는
 * 접혀 있어도 '지금은 코칭에 사용하지 않고 있어요'로 부드럽게 알린다. 관찰은 의견이 없거나 두
 * 사람이 남겨도 확정된 사실로 바뀌지 않는다.
 */
export function PatternObservationCard({ observation }: { observation: PatternObservation }) {
  const { account } = useActiveAccount();
  const excluded = isExcludedFromCoaching(observation);
  const exclusionNote = coachingExclusionNote(observation);
  const [expanded, setExpanded] = useState(false);

  // 계정을 전환하면 이 카드를 접는다 — 새 계정 시점에서 다시 펼쳐 보게 한다.
  const [cardAccountId, setCardAccountId] = useState(account.id);
  if (cardAccountId !== account.id) {
    setCardAccountId(account.id);
    setExpanded(false);
  }

  const opinionCount = new Set(observation.opinions.map((opinion) => opinion.authorId)).size;

  return (
    <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-3.5">
      <p className="text-sm leading-snug text-ink">{observation.observation}</p>

      {excluded ? (
        <p className="mt-1 text-xs text-ink-faint">
          {exclusionNote} — 관련 실천 제안은 표시하지 않아요.
        </p>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-coaching">
          작은 실천 · {observation.suggestion}
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="mt-2 text-xs font-medium text-accent"
      >
        {expanded
          ? '접기'
          : opinionCount > 0
            ? `자세히 보기 (의견 ${opinionCount})`
            : '자세히 보기'}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <EvidenceQuotes observation={observation} />
          <ObservationControls observation={observation} />
        </div>
      )}
    </section>
  );
}

/** 근거가 된 대화 인용. `evidenceQuotes`(여러 장면)가 없으면 `evidenceText` 한 줄로 대체한다. */
export function EvidenceQuotes({ observation }: { observation: PatternObservation }) {
  const quotes =
    observation.evidenceQuotes && observation.evidenceQuotes.length > 0
      ? observation.evidenceQuotes
      : observation.evidenceText
        ? [observation.evidenceText]
        : [];

  if (quotes.length === 0) return null;

  return (
    <div className="text-xs leading-relaxed text-ink-soft">
      <p className="eyebrow mb-1 text-ink-faint">근거가 된 대화</p>
      <ul className="flex flex-col gap-1.5">
        {quotes.map((quote) => (
          <li key={quote} className="border-l-2 border-border pl-2 italic">
            {quote}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 관찰에 대한 조작 영역 — 대표 발견(`HeadlineFinding`)과 보조 카드가 공유한다.
 * **공개·적용 범위 안내를 조작 전에 먼저 보여준다**(0007 §5). 순서: 범위 안내 → (제외 안내) →
 * 의견 → 코칭 제외 조작.
 */
export function ObservationControls({ observation }: { observation: PatternObservation }) {
  const excluded = isExcludedFromCoaching(observation);
  const summary = opinionSummary(observation);

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-soft">
        남긴 의견은 상대에게도 보여요. 코칭에서 제외하면 두 사람의 관련 코칭에 모두 적용돼요.
      </p>

      {excluded && (
        <p className="rounded-xl bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-faint">
          이 관찰은 코칭에 사용하지 않기로 해서 관련 실천 제안을 표시하지 않아요. 관찰·근거·의견은
          그대로 볼 수 있어요.
        </p>
      )}

      <OpinionSection observation={observation} summary={summary} />
      <CoachingOptOutControl observation={observation} />
    </div>
  );
}

function authorLabel(
  opinion: PatternOpinion,
  meId: string,
  meNickname: string,
  partnerNickname: string,
): string {
  return opinion.authorId === meId ? `${meNickname}(나)` : partnerNickname;
}

function OpinionSection({
  observation,
  summary,
}: {
  observation: PatternObservation;
  summary: 'none' | 'one' | 'both';
}) {
  const { account, partner } = useActiveAccount();
  const { addOpinion, editOpinion, removeOpinion } = usePatterns();

  const mine = ownOpinion(observation, account.id);

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  // 계정을 전환하면 작성·수정 중이던 입력창과 초안을 버린다 — 한 사람이 쓰던 내용이 다른 계정
  // 이름으로 저장되지 않도록(ChatPage가 계정 전환 시 초안을 비우는 것과 같은 규칙).
  const [editorAccountId, setEditorAccountId] = useState(account.id);
  if (editorAccountId !== account.id) {
    setEditorAccountId(account.id);
    setEditing(false);
    setText('');
  }

  function openEditor() {
    setText(mine?.text ?? '');
    setEditing(true);
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (mine) editOpinion(observation.id, mine.id, trimmed);
    else addOpinion(observation.id, trimmed);
    setEditing(false);
  }

  return (
    <div>
      <p className="eyebrow mb-2 text-ink-faint">
        {summary === 'both'
          ? '두 사람이 남긴 의견'
          : summary === 'one'
            ? '남긴 의견'
            : '의견 (선택)'}
      </p>

      {observation.opinions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {observation.opinions.map((opinion) => (
            <li key={opinion.id} className="rounded-xl bg-canvas px-3 py-2">
              <p className="text-xs font-medium text-ink-soft">
                {authorLabel(opinion, account.id, account.nickname, partner.nickname)}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink">{opinion.text}</p>
              {opinion.authorId === account.id && !editing && (
                <div className="mt-1.5 flex gap-3">
                  <button
                    type="button"
                    onClick={openEditor}
                    className="text-xs font-medium text-accent"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => removeOpinion(observation.id, opinion.id)}
                    className="text-xs font-medium text-ink-faint"
                  >
                    삭제
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="mt-2 rounded-xl border border-border p-3">
          <p className="text-xs leading-relaxed text-ink-soft">
            입력한 의견은 {partner.nickname}님에게도 보여요. 두 사람의 의견은 정답을 고르지 않고
            나란히 표시돼요.
          </p>
          <textarea
            aria-label="의견 입력"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={submit}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-canvas-raised disabled:opacity-40"
              disabled={!text.trim()}
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full border border-border px-4 py-1.5 text-sm text-ink-soft"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        !mine && (
          <button
            type="button"
            onClick={openEditor}
            className="mt-2 rounded-full border border-border px-4 py-1.5 text-sm text-ink-soft"
          >
            의견 남기기
          </button>
        )
      )}
    </div>
  );
}

function CoachingOptOutControl({ observation }: { observation: PatternObservation }) {
  const { account, partner } = useActiveAccount();
  const { optOut, revokeOwnOptOut } = usePatterns();

  const mineOptedOut = hasOptedOut(observation, account.id);
  const partnerOptedOut = observation.coachingOptOuts.some(
    (optOutEntry) => optOutEntry.userId === partner.id,
  );

  return (
    <div className="border-t border-border pt-3">
      <p className="eyebrow mb-1 text-ink-faint">코칭 활용</p>
      <p className="text-xs leading-relaxed text-ink-faint">
        코칭에서 제외하면 두 사람의 대화 코칭과 이 리포트의 관련 실천 제안에 사용하지 않아요. 한
        명이라도 제외하면 두 사람 모두에게 적용되고, 각자 자신의 제외만 해제할 수 있어요.
      </p>

      {partnerOptedOut && (
        <p className="mt-2 text-xs text-ink-soft">
          {partner.nickname}님이 이 관찰을 코칭에서 제외했어요. 이 선택은 내가 해제할 수 없어요.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {mineOptedOut ? (
          <button
            type="button"
            onClick={() => revokeOwnOptOut(observation.id)}
            className="rounded-full border border-border px-4 py-1.5 text-sm text-ink-soft"
          >
            내 제외 해제
          </button>
        ) : (
          <button
            type="button"
            onClick={() => optOut(observation.id)}
            className="rounded-full border border-pending/40 bg-pending-soft px-4 py-1.5 text-sm font-medium text-pending"
          >
            {partnerOptedOut ? '나도 코칭에서 제외하기' : '이 관찰을 코칭에서 제외하기'}
          </button>
        )}
      </div>
    </div>
  );
}
