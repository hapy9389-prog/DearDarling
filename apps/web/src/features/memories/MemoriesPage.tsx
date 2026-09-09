import { useState, type ReactNode } from 'react';
import { useNavigation } from '../../state/NavigationContext';
import { useScenario } from '../../state/ScenarioContext';
import { useSettings } from '../../state/SettingsContext';
import { useMemories } from '../../state/MemoriesContext';
import { getAccount } from '../../mocks/fixtures/accounts';
import {
  conversationDateLabel,
  groupBySavedDate,
  memoryCardLayout,
} from '../../mocks/domain/memories';
import type { Memory } from '../../mocks/types';
import { ExampleImage } from './ExampleImage';
import { MemoryDetail } from './MemoryDetail';

/**
 * 추억 — 의미 있는 이미지와 대화 기록을 함께 돌아보는 앨범(docs/decisions/0008). 세 영역:
 *  ① 그때의 우리 — 앨범에 저장된 추억에서 파생한 리마인드(후보 있을 때만).
 *  ② AI가 발견한 순간 — 시드 예시 제안. 양측 분석 동의 게이트 O. '간직하기' = 커플 공유 저장, '숨기기' = 개인.
 *  ③ 우리 앨범 — 저장된 추억. 게이트 없음(분석 동의와 무관하게 유지).
 */
export function MemoriesPage() {
  const { params } = useNavigation();
  const { memories } = useMemories();
  const [selectedId, setSelectedId] = useState<string | null>(params.memoryId ?? null);

  // navigate()는 호출마다 새 params 객체를 만든다. 하단 '추억' 탭을 다시 누르면(빈 params) 목록으로
  // 돌아가고, 홈의 '최근 추억'에서 들어오면(memoryId) 그 상세로 연다.
  const [seenParams, setSeenParams] = useState(params);
  if (seenParams !== params) {
    setSeenParams(params);
    setSelectedId(params.memoryId ?? null);
  }

  const selected = selectedId ? (memories.find((m) => m.id === selectedId) ?? null) : null;

  return (
    <div data-testid="memories-page" className="flex flex-1 flex-col overflow-y-auto">
      <header className="border-b border-border bg-canvas-raised px-4 py-3">
        <p className="font-display text-lg">추억</p>
      </header>

      {selected ? (
        <MemoryDetail memory={selected} onBack={() => setSelectedId(null)} />
      ) : (
        <div className="flex flex-col gap-6 px-4 py-5">
          <RememberWhenCard onOpen={setSelectedId} />
          <SuggestedMoments onOpen={setSelectedId} />
          <Album memories={memories} onOpen={setSelectedId} />
        </div>
      )}
    </div>
  );
}

function ExampleBadge() {
  return (
    <span className="eyebrow rounded-full bg-pending-soft px-2 py-0.5 text-pending">예시</span>
  );
}

function RememberWhenCard({ onOpen }: { onOpen: (id: string) => void }) {
  const { rememberWhen, dismissRememberWhen } = useMemories();
  if (!rememberWhen) return null;

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <p className="eyebrow text-ink-faint">그때의 우리</p>
        <ExampleBadge />
      </div>
      <button
        type="button"
        onClick={() => onOpen(rememberWhen.memory.id)}
        className="block w-full text-left"
      >
        <p className="font-display text-base leading-snug text-ink">
          {rememberWhen.phrase}, 이런 대화를 나눴어요
        </p>
        <p className="mt-1 border-l-2 border-border pl-2 text-sm leading-relaxed text-ink-soft italic">
          {rememberWhen.memory.quoteBody}
        </p>
      </button>
      <button
        type="button"
        onClick={() => dismissRememberWhen(rememberWhen.dismissKey)}
        className="mt-2 text-xs text-ink-faint"
      >
        이 리마인드 닫기
      </button>
    </section>
  );
}

function SuggestedMoments({ onOpen }: { onOpen: (id: string) => void }) {
  const { scenario } = useScenario();
  const settings = useSettings();
  const { suggestions, keepSuggestion, hideSuggestion } = useMemories();

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <p className="eyebrow text-ink-faint">AI가 발견한 순간</p>
        <ExampleBadge />
      </div>
      <SuggestedBody
        analysisActive={settings.coupleAnalysisActive}
        scenario={scenario}
        empty={suggestions.length === 0}
      >
        <p className="text-xs leading-relaxed text-ink-soft">
          AI가 대화에서 찾아볼 만한 순간의 예시예요. 실제 분석 결과가 아니에요.
        </p>
        <p className="mt-2 rounded-xl bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-soft">
          간직하면 두 사람의 앨범에 저장돼요. 숨기기는 내 목록에서만 적용돼요.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          {suggestions.map((suggestion) => {
            const sender = getAccount(suggestion.quoteSenderId);
            return (
              <article
                key={suggestion.id}
                className="rounded-2xl border border-coaching-border bg-coaching-soft px-4 py-3"
              >
                {suggestion.images && suggestion.images[0] && (
                  <div className="mb-2">
                    <ExampleImage image={suggestion.images[0]} size="card" />
                  </div>
                )}
                <p className="border-l-2 border-coaching-border pl-2 text-sm leading-relaxed text-ink italic">
                  {suggestion.quoteBody}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-coaching">
                  발견 이유 · {suggestion.reason}
                </p>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {sender.nickname} · {conversationDateLabel(suggestion.conversationAt)}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const saved = keepSuggestion(suggestion.id);
                      if (saved) onOpen(saved.id);
                    }}
                    className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-canvas-raised"
                  >
                    간직하기
                  </button>
                  <button
                    type="button"
                    onClick={() => hideSuggestion(suggestion.id)}
                    className="rounded-full border border-border px-4 py-1.5 text-sm text-ink-soft"
                  >
                    숨기기
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </SuggestedBody>
    </section>
  );
}

function SuggestedBody({
  analysisActive,
  scenario,
  empty,
  children,
}: {
  analysisActive: boolean;
  scenario: string;
  empty: boolean;
  children: ReactNode;
}) {
  if (!analysisActive) {
    return (
      <Notice
        title="AI가 발견한 순간이 중단됐어요"
        body="두 사람이 모두 AI 분석에 동의하면 대화에서 찾은 순간을 볼 수 있어요. 직접 저장한 추억은 그대로 유지돼요."
      />
    );
  }
  if (scenario === 'ai-warming-up') {
    return <Notice title="발견한 순간을 준비하고 있어요" body="잠시 후 다시 확인해 주세요." />;
  }
  if (scenario === 'ai-failure') {
    return (
      <Notice
        title="지금은 불러올 수 없어요"
        body="일시적인 문제예요. 잠시 후 다시 시도해 주세요."
      />
    );
  }
  if (scenario === 'empty' || empty) {
    return (
      <Notice title="아직 발견한 순간이 없어요" body="대화가 더 쌓이면 예시로 보여드릴게요." />
    );
  }
  return <>{children}</>;
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-canvas-raised px-4 py-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}

function Album({ memories, onOpen }: { memories: Memory[]; onOpen: (id: string) => void }) {
  const { navigate } = useNavigation();

  if (memories.length === 0) {
    return (
      <section>
        <p className="eyebrow mb-2 text-ink-faint">우리 앨범</p>
        <div className="rounded-2xl border border-border bg-canvas-raised px-4 py-6 text-center">
          <p className="text-sm leading-relaxed text-ink-soft">
            아직 앨범이 비어 있어요. 대화에서 소중한 메시지를 눌러 추억으로 저장해 보세요.
          </p>
          <button
            type="button"
            onClick={() => navigate('chat')}
            className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-medium text-canvas-raised"
          >
            대화로 이동
          </button>
        </div>
      </section>
    );
  }

  const groups = groupBySavedDate(memories);

  return (
    <section>
      <p className="eyebrow mb-2 text-ink-faint">우리 앨범</p>
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-3">
            <p className="text-xs font-medium text-ink-faint">{group.label}</p>
            {group.memories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function MemoryCard({ memory, onOpen }: { memory: Memory; onOpen: (id: string) => void }) {
  const sender = getAccount(memory.quoteSenderId);
  const savedBy = getAccount(memory.savedByUserId);
  const layout = memoryCardLayout(memory);

  const meta = (
    <p className="mt-2 text-[11px] text-ink-faint">
      {sender.nickname}의 말 · 대화 {conversationDateLabel(memory.conversationAt)} ·{' '}
      {savedBy.nickname} 저장{memory.fromSuggestion && ' · AI가 발견'}
    </p>
  );

  if (layout === 'photo' && memory.images && memory.images[0]) {
    return (
      <button type="button" onClick={() => onOpen(memory.id)} className="block w-full text-left">
        <ExampleImage image={memory.images[0]} size="card" />
        {memory.note && <p className="mt-2 text-sm leading-relaxed text-ink">{memory.note}</p>}
        <p className="mt-1 border-l-2 border-border pl-2 text-xs leading-relaxed text-ink-soft italic">
          {memory.quoteBody}
        </p>
        {meta}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(memory.id)}
      className="block w-full rounded-xl border border-border bg-canvas-raised px-4 py-3 text-left"
    >
      <p className="border-l-2 border-border pl-2 text-sm leading-relaxed text-ink italic">
        {memory.quoteBody}
      </p>
      {memory.note && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{memory.note}</p>}
      {meta}
    </button>
  );
}
