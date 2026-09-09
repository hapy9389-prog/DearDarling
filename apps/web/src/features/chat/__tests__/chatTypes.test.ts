import { describe, expect, it } from 'vitest';
import { filterVisibleMessages } from '../chatTypes';
import type { ChatMessage } from '../../../mocks/types';

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    coupleId: 'couple-1',
    senderId: 'user-a',
    body: '안녕',
    createdAt: new Date().toISOString(),
    status: 'saved',
    ...overrides,
  };
}

describe('filterVisibleMessages — 전송 중/실패는 보낸 사람만 본다', () => {
  it('내가 보낸 메시지는 전송 중/실패/저장 완료 상태 모두 보인다', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'sending', senderId: 'user-a', status: 'sending' }),
      makeMessage({ id: 'failed', senderId: 'user-a', status: 'failed' }),
      makeMessage({ id: 'saved', senderId: 'user-a', status: 'saved' }),
    ];
    const visible = filterVisibleMessages(messages, 'user-a');
    expect(visible.map((m) => m.id)).toEqual(['sending', 'failed', 'saved']);
  });

  it('상대가 보낸 메시지는 저장 완료된 것만 보인다', () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: 'sending', senderId: 'user-b', status: 'sending' }),
      makeMessage({ id: 'failed', senderId: 'user-b', status: 'failed' }),
      makeMessage({ id: 'saved', senderId: 'user-b', status: 'saved' }),
    ];
    const visible = filterVisibleMessages(messages, 'user-a');
    expect(visible.map((m) => m.id)).toEqual(['saved']);
  });
});
