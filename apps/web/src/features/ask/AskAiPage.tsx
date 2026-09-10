import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useNavigation } from '../../state/NavigationContext';
import { createMockConsultationService } from '../../mocks/services/consultationService';

const consultationService = createMockConsultationService();

interface Turn {
  id: string;
  role: 'user' | 'ai';
  text: string;
}

/**
 * '우리' 탭 → 'AI에게 물어보기'. 개인 상담(개인 채널)이다.
 * - 공유 리포트와 명확히 구분하고, 상담 내용은 상대·공유 리포트에 자동 공개되지 않는다.
 * - 이번 단계는 화면 검토용 예시다 — 실제 AI 답변이 아니다.
 * - 계정을 전환하면 이전 상담 내역을 초기화하고, 이전 계정에서 요청한 늦은 답변도 새 계정 화면에
 *   나타나지 않게 한다(ChatPage의 계정 격리 패턴과 동일).
 */
export function AskAiPage() {
  const { navigate } = useNavigation();
  const { account, partner } = useActiveAccount();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [askedPromptIds, setAskedPromptIds] = useState<string[]>([]);
  const [awaiting, setAwaiting] = useState(false);

  // 상담 세션 번호. 상담이 초기화될 때마다(계정 전환 등) 1씩 올라간다. 진행 중이던 요청은
  // "자기가 시작된 세션"을 기억해 뒀다가, 완료 시점의 세션과 다르면 답변도 완료 처리도 버린다.
  // 계정 ID만 비교하면 민준 → 서연 → 민준으로 돌아왔을 때 이전 민준 세션의 늦은 답변이
  // 초기화된 화면에 섞인다 — 세션 번호는 "초기화 전후"까지 구분한다.
  const [sessionId, setSessionId] = useState(0);

  // 계정을 전환하면 이전 사람의 상담 내역·진행 상태를 새 계정 화면으로 넘기지 않는다.
  const [loadedAccountId, setLoadedAccountId] = useState(account.id);
  if (loadedAccountId !== account.id) {
    setLoadedAccountId(account.id);
    setTurns([]);
    setAskedPromptIds([]);
    setAwaiting(false);
    setSessionId((n) => n + 1);
  }

  // 렌더 중 ref를 직접 쓰지 않고(ChatPage와 동일) 이펙트에서 한 박자 늦게 갱신한다 — 답변 지연이
  // 600ms라 그보다 훨씬 먼저 최신값이 반영된다.
  const latestSessionRef = useRef(sessionId);
  useEffect(() => {
    latestSessionRef.current = sessionId;
  }, [sessionId]);

  const prompts = useMemo(() => consultationService.listPrompts(), []);
  const remainingPrompts = prompts.filter((prompt) => !askedPromptIds.includes(prompt.id));

  async function ask(promptId: string, question: string) {
    const requestSession = sessionId;
    const isCurrentSession = () => latestSessionRef.current === requestSession;
    setAskedPromptIds((prev) => [...prev, promptId]);
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: question }]);
    setAwaiting(true);
    try {
      const answer = await consultationService.ask(promptId);
      // 그 사이 상담이 초기화됐으면(계정 전환 등) 이 답변을 화면에 넣지 않는다.
      if (!isCurrentSession()) return;
      setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: 'ai', text: answer }]);
    } finally {
      if (isCurrentSession()) setAwaiting(false);
    }
  }

  return (
    <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-border bg-canvas-raised px-2 py-3">
        <button
          type="button"
          onClick={() => navigate('week')}
          aria-label="우리 탭으로"
          className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
        >
          <span aria-hidden="true">←</span>
        </button>
        <div>
          <p className="font-display text-lg leading-tight">AI에게 물어보기</p>
          <p className="text-xs text-ink-soft">개인 상담 · {account.nickname}님만 볼 수 있어요</p>
        </div>
      </header>

      <div className="border-b border-pending-soft bg-pending-soft px-4 py-2">
        <p className="eyebrow text-pending">화면 검토용 예시이며 실제 AI 답변이 아닙니다</p>
      </div>

      <div className="flex flex-col gap-4 px-4 py-5">
        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
          <p className="eyebrow mb-2 text-ink-faint">공유 리포트와 개인 상담</p>
          <p className="text-sm leading-relaxed text-ink-soft">
            ‘우리’ 탭의 주간 리포트는 두 사람이 함께 봐요. 이 상담은 {account.nickname}님 개인
            채널이라, 여기서 나눈 내용은 {partner.nickname}님이나 공유 리포트에 자동으로 올라가지
            않아요.
          </p>
        </section>

        {turns.length > 0 && (
          <div className="flex flex-col gap-2">
            {turns.map((turn) => (
              <div
                key={turn.id}
                className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <p
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    turn.role === 'user'
                      ? 'rounded-br-md bg-mine-bubble text-mine-bubble-text'
                      : 'rounded-bl-md bg-coaching-soft text-ink'
                  }`}
                >
                  {turn.text}
                </p>
              </div>
            ))}
            {awaiting && (
              <p className="px-1 text-xs text-ink-faint">예시 답변을 불러오고 있어요…</p>
            )}
          </div>
        )}

        <section>
          <p className="eyebrow mb-2 text-ink-faint">예시 질문</p>
          {remainingPrompts.length > 0 ? (
            <div className="flex flex-col gap-2">
              {remainingPrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  disabled={awaiting}
                  onClick={() => ask(prompt.id, prompt.question)}
                  className="rounded-xl border border-border bg-canvas-raised px-3 py-2 text-left text-sm text-ink disabled:opacity-40"
                >
                  {prompt.question}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-soft">예시 질문을 모두 확인했어요.</p>
          )}
        </section>
      </div>

      <div className="mt-auto border-t border-border bg-canvas-raised px-4 py-3">
        <input
          aria-label="상담 입력"
          disabled
          placeholder="직접 입력은 실제 AI 연결 이후에 지원해요"
          className="w-full rounded-full border border-border bg-canvas px-4 py-2.5 text-sm text-ink-faint outline-none"
        />
        <p className="mt-1.5 text-[11px] text-ink-faint">
          지금은 예시 질문만 눌러볼 수 있어요. 실제 대화를 분석하는 상담과 그 동의 방식은 이후
          단계에서 정해요.
        </p>
      </div>
    </div>
  );
}
