import type { ChatMessage, ChatDevScenario } from '../types';
import { mockDelay } from '../delay';
import { SEED_MESSAGES } from '../fixtures/messages';
import { coupleKey, readJSON, writeJSON } from '../storage';

export interface SendMessageParams {
  coupleId: string;
  senderId: string;
  body: string;
  /** 재시도해도 같은 메시지가 중복 생성되지 않도록 하는 클라이언트 발급 ID(문서의 clientMessageId 개념). */
  clientMessageId: string;
}

export interface SendMessageHandlers {
  /** 저장 완료/실패가 확정되기 전, "전송 중" 상태를 즉시 반영하기 위한 콜백. */
  onPending: (message: ChatMessage) => void;
}

export interface ChatService {
  listMessages(coupleId: string): ChatMessage[];
  sendMessage(params: SendMessageParams, handlers: SendMessageHandlers): Promise<ChatMessage>;
  retryMessage(
    coupleId: string,
    messageId: string,
    handlers: SendMessageHandlers,
  ): Promise<ChatMessage>;
}

// '정상/AI 준비 중/AI 장애/연결 끊김'은 대화 내용이 다른 게 아니라 연결·AI 상태만 다른
// 같은 하나의 대화다 — 그래서 모두 이 공용 저장 공간을 함께 쓴다. 연결이 끊긴 상태에서
// 실패한 메시지도, 다시 '정상'으로 돌아오면 같은 대화 안에서 그대로 보이고 재전송할 수 있다.
function mainMessagesStorageKey(coupleId: string): string {
  return coupleKey(coupleId, 'messages');
}

function loadMessages(coupleId: string, scenario: ChatDevScenario): ChatMessage[] {
  // '빈 대화'는 예외다: 저장 공간을 아예 읽지 않는다 — 그래서 이 시나리오를 선택할 때마다
  // (직전에 무엇을 보냈든) 항상 빈 화면으로 시작한다. 자세한 이유는
  // docs/decisions/0002-chat-review-behavior-rules.md 참고.
  if (scenario === 'empty') return [];
  return readJSON<ChatMessage[]>(mainMessagesStorageKey(coupleId), SEED_MESSAGES);
}

function saveMessages(coupleId: string, scenario: ChatDevScenario, messages: ChatMessage[]): void {
  // 같은 이유로 '빈 대화' 시나리오에서 보낸 메시지는 저장하지 않는다 — 다른 시나리오로
  // 넘어가거나 다시 들어오면 사라지는 것이 의도된 동작이다.
  if (scenario === 'empty') return;
  writeJSON(mainMessagesStorageKey(coupleId), messages);
}

export interface CreateMockChatServiceOptions {
  /** 시나리오에 따라 전송 실패를 강제해 "실패·재시도" 상태를 검토할 수 있게 한다. */
  scenario: ChatDevScenario;
}

export function createMockChatService(options: CreateMockChatServiceOptions): ChatService {
  const { scenario } = options;

  async function settle(
    coupleId: string,
    optimistic: ChatMessage,
    handlers: SendMessageHandlers,
  ): Promise<ChatMessage> {
    handlers.onPending(optimistic);

    const before = loadMessages(coupleId, scenario);
    const withPending = before.some((m) => m.id === optimistic.id)
      ? before.map((m) => (m.id === optimistic.id ? optimistic : m))
      : [...before, optimistic];
    saveMessages(coupleId, scenario, withPending);

    await mockDelay(700);

    // disconnected 시나리오에서는 전송이 계속 실패한다 — 재접속(다른 시나리오로 전환) 전까지
    // 재시도해도 실패를 유지한다. '정상'으로 돌아와 재시도하면 같은 메시지가 성공으로 바뀐다.
    const shouldFail = scenario === 'disconnected';
    const settled: ChatMessage = { ...optimistic, status: shouldFail ? 'failed' : 'saved' };

    const after = loadMessages(coupleId, scenario);
    saveMessages(
      coupleId,
      scenario,
      after.map((m) => (m.id === settled.id ? settled : m)),
    );

    return settled;
  }

  return {
    listMessages(coupleId) {
      return loadMessages(coupleId, scenario);
    },

    sendMessage(params, handlers) {
      const existing = loadMessages(params.coupleId, scenario).find(
        (m) => m.id === params.clientMessageId,
      );
      if (existing && existing.status !== 'failed') {
        // 같은 clientMessageId로 재요청해도 한 건만 생긴다.
        handlers.onPending(existing);
        return Promise.resolve(existing);
      }

      const optimistic: ChatMessage = {
        id: params.clientMessageId,
        coupleId: params.coupleId,
        senderId: params.senderId,
        body: params.body,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };

      return settle(params.coupleId, optimistic, handlers);
    },

    retryMessage(coupleId, messageId, handlers) {
      const messages = loadMessages(coupleId, scenario);
      const target = messages.find((m) => m.id === messageId);
      if (!target) return Promise.reject(new Error('재시도할 메시지를 찾을 수 없습니다.'));

      const pending: ChatMessage = { ...target, status: 'sending' };
      return settle(coupleId, pending, handlers);
    },
  };
}
