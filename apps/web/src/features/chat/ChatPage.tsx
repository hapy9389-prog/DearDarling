import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useSettings } from '../../state/SettingsContext';
import { useScenario } from '../../state/ScenarioContext';
import { createMockChatService } from '../../mocks/services/chatService';
import { createMockCoachingService } from '../../mocks/services/coachingService';
import type { ChatMessage } from '../../mocks/types';
import type { CoachingAreaState } from './chatTypes';
import { filterVisibleMessages, selectSavedMessages, upsertMessage } from './chatTypes';
import { PartnerProfileHeader } from './PartnerProfileHeader';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import { CoachingArea } from './CoachingArea';
import { MessageList } from './MessageList';
import { EmptyChatState } from './EmptyChatState';
import { MessageInputBar } from './MessageInputBar';
import { OverwriteDraftDialog } from './OverwriteDraftDialog';

const coachingService = createMockCoachingService();

export function ChatPage() {
  const { account, partner } = useActiveAccount();
  const settings = useSettings();
  const { scenario } = useScenario();

  const chatService = useMemo(() => createMockChatService({ scenario }), [scenario]);

  // '정상/AI 준비 중/AI 장애/연결 끊김'은 연결·AI 상태만 다른 같은 하나의 대화이고,
  // '빈 대화'만 저장 공간이 없는 별개의 대화다(docs/decisions/0002 §2). 전송 완료 결과를
  // 지금 화면에 반영할지 판단할 때는 시나리오 이름이 아니라 이 "대화 식별값"으로 비교한다.
  const conversationId: 'main' | 'empty' = scenario === 'empty' ? 'empty' : 'main';

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    chatService.listMessages(account.coupleId),
  );
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [coachingArea, setCoachingArea] = useState<CoachingAreaState>({ kind: 'loading' });
  const [draft, setDraft] = useState('');
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);

  // 시나리오가 바뀌면 대화 목록을 다시 불러온다. 렌더 중에 바로 반영해(React가 권장하는
  // "prop이 바뀌면 상태를 조정하는" 패턴) 이펙트 안에서 동기적으로 setState하지 않도록 한다.
  const [loadedScenario, setLoadedScenario] = useState(scenario);
  if (loadedScenario !== scenario) {
    setLoadedScenario(scenario);
    setMessages(chatService.listMessages(account.coupleId));
    setHighlightedIds([]);
  }

  // '빈 대화'는 들어올 때마다 새로운 "방문"이다 — 나갔다 다시 들어오면 이전 방문에서 진행 중이던
  // 전송의 늦은 결과가 이번 빈 화면에 섞이면 안 된다. 대화(conversationId)가 바뀔 때마다 방문
  // 번호를 올려, "이 전송을 시작한 방문"과 "지금 방문"을 구분한다.
  const [visit, setVisit] = useState(0);
  const [loadedConversationId, setLoadedConversationId] = useState(conversationId);
  if (loadedConversationId !== conversationId) {
    setLoadedConversationId(conversationId);
    setVisit((v) => v + 1);
  }

  // 전송·재시도가 끝났을 때 그 결과를 지금 화면에 반영해도 되는지 판단하는 기준값.
  // - 같은 대화('main')면 그 사이 상태만 바꿔도(예: 정상 → AI 준비 중) 결과를 반영한다.
  //   시나리오 이름만 비교하면 이 경우에도 결과를 버려 말풍선이 '전송 중'에 멈춰버린다.
  // - '빈 대화'는 저장이 없으므로 방문이 다르면(나갔다 다시 들어오면) 이전 방문 결과를 버린다.
  // 전송·재시도는 700ms 뒤에 끝나므로, 이펙트에서 한 박자 늦게 갱신해도 그보다 훨씬 먼저
  // 최신값이 반영되어 문제없다(렌더 중 ref를 직접 읽고 쓰는 것은 React 규칙상 피한다).
  const reconcileToken = conversationId === 'empty' ? `empty#${visit}` : 'main';
  const latestReconcileTokenRef = useRef(reconcileToken);
  useEffect(() => {
    latestReconcileTokenRef.current = reconcileToken;
  }, [reconcileToken]);

  // 테스트 계정을 전환하면 아직 보내지 않은 초안·확인 대기 중인 추천은 새 계정으로 넘어가지 않는다.
  const [draftForAccountId, setDraftForAccountId] = useState(account.id);
  if (draftForAccountId !== account.id) {
    setDraftForAccountId(account.id);
    setDraft('');
    setPendingSuggestion(null);
  }

  // 코칭 영역 상태 계산: 분석 동의/철회를 가장 먼저 확인한다 — 철회했다면 AI가 "준비 중"이든
  // 아니든 상관없이 곧바로 분석 중단 안내를 보여줘야 한다(동의 여부가 AI 가동 상태보다 우선).
  // 순서: 분석 동의·철회 → AI 상태(준비 중/장애) → 코칭 숨기기 → 실제 제안.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!settings.coupleAnalysisActive) {
        setCoachingArea({
          kind: 'consent-pending',
          reason: settings.mine.analysisConsent ? 'partner' : 'self',
        });
        return;
      }
      if (scenario === 'ai-warming-up') {
        setCoachingArea({ kind: 'warming-up' });
        return;
      }
      if (!settings.mine.coachingVisible) {
        setCoachingArea({ kind: 'hidden' });
        return;
      }

      setCoachingArea({ kind: 'loading' });
      const result = await coachingService.getSuggestion({
        recipientId: account.id,
        scenario,
        // 저장이 확정된 메시지만 근거로 쓴다(전송 중·실패 메시지는 제외).
        availableMessages: selectSavedMessages(messages),
      });
      if (cancelled) return;

      if (result.status === 'failure') setCoachingArea({ kind: 'failure' });
      else if (result.status === 'ready')
        setCoachingArea({ kind: 'ready', suggestion: result.suggestion });
      else setCoachingArea({ kind: 'idle' });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [
    scenario,
    settings.coupleAnalysisActive,
    settings.mine.coachingVisible,
    settings.mine.analysisConsent,
    messages,
    account.id,
  ]);

  async function handleSend(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const clientMessageId = crypto.randomUUID();
    // 이 요청을 시작한 시점의 대화 식별값을 기억해 둔다 — 완료됐을 때 값이 달라졌으면
    // (다른 대화로 갔거나, '빈 대화'를 나갔다 다시 들어왔으면) 그 결과를 화면에 반영하지 않는다.
    const requestToken = reconcileToken;
    const isForCurrentView = () => latestReconcileTokenRef.current === requestToken;
    setDraft('');
    setIsSending(true);
    try {
      const settled = await chatService.sendMessage(
        { coupleId: account.coupleId, senderId: account.id, body: text, clientMessageId },
        {
          onPending: (msg) => {
            if (!isForCurrentView()) return;
            setMessages((prev) => upsertMessage(prev, msg));
          },
        },
      );
      if (isForCurrentView()) {
        setMessages((prev) => upsertMessage(prev, settled));
      }
    } finally {
      setIsSending(false);
    }
  }

  async function handleRetry(messageId: string) {
    const requestToken = reconcileToken;
    const isForCurrentView = () => latestReconcileTokenRef.current === requestToken;
    setIsSending(true);
    try {
      const settled = await chatService.retryMessage(account.coupleId, messageId, {
        onPending: (msg) => {
          if (!isForCurrentView()) return;
          setMessages((prev) => upsertMessage(prev, msg));
        },
      });
      if (isForCurrentView()) {
        setMessages((prev) => upsertMessage(prev, settled));
      }
    } finally {
      setIsSending(false);
    }
  }

  function handleSelectSuggestion(text: string) {
    if (draft.trim() && draft.trim() !== text.trim()) {
      setPendingSuggestion(text);
      return;
    }
    setDraft(text);
  }

  // 전송 중·실패는 보낸 사람만 보는 로컬 상태다 — 상대방 시점에는 저장 완료된 메시지만 보인다.
  const visibleMessages = filterVisibleMessages(messages, account.id);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <PartnerProfileHeader partner={partner} />
      {scenario === 'disconnected' && <ConnectionStatusBanner />}
      <CoachingArea
        state={coachingArea}
        onSelectSuggestion={handleSelectSuggestion}
        onHighlightEvidence={setHighlightedIds}
      />

      {visibleMessages.length === 0 ? (
        <EmptyChatState partnerNickname={partner.nickname} />
      ) : (
        <MessageList
          messages={visibleMessages}
          myAccountId={account.id}
          highlightedMessageIds={highlightedIds}
          onRetry={handleRetry}
        />
      )}

      <MessageInputBar
        draft={draft}
        onDraftChange={setDraft}
        onSend={handleSend}
        disabled={isSending}
      />

      {pendingSuggestion && (
        <OverwriteDraftDialog
          suggestion={pendingSuggestion}
          onConfirm={() => {
            setDraft(pendingSuggestion);
            setPendingSuggestion(null);
          }}
          onCancel={() => setPendingSuggestion(null)}
        />
      )}
    </div>
  );
}
