import { afterEach, describe, expect, it } from 'vitest';
import { createMockChatService } from '../chatService';
import { resetAllMockData } from '../../storage';
import { COUPLE_ID, TEST_ACCOUNTS } from '../../fixtures/accounts';

const MINJUN = TEST_ACCOUNTS[0].id;

afterEach(() => {
  resetAllMockData();
});

describe('chatService — 시나리오별 저장 공간 분리', () => {
  it('다른 시나리오에서 메시지를 보낸 뒤에도 빈 대화 시나리오는 그대로 비어 있다', async () => {
    const happyPath = createMockChatService({ scenario: 'happy-path' });
    await happyPath.sendMessage(
      { coupleId: COUPLE_ID, senderId: MINJUN, body: '안녕', clientMessageId: 'client-1' },
      { onPending: () => {} },
    );

    // happy-path 자체 데이터는 남아 있어야 한다(불필요하게 지우지 않음).
    expect(happyPath.listMessages(COUPLE_ID).length).toBeGreaterThan(0);

    // 하지만 '빈 대화' 시나리오는 happy-path의 전송과 무관하게 항상 비어 있어야 한다.
    const empty = createMockChatService({ scenario: 'empty' });
    expect(empty.listMessages(COUPLE_ID)).toEqual([]);
  });

  it('정상/AI 준비 중/AI 장애/연결 끊김은 같은 하나의 대화(저장 공간)를 공유한다', async () => {
    const disconnected = createMockChatService({ scenario: 'disconnected' });
    await disconnected.sendMessage(
      {
        coupleId: COUPLE_ID,
        senderId: MINJUN,
        body: '연결 끊김에서 보낸 메시지',
        clientMessageId: 'client-2',
      },
      { onPending: () => {} },
    );

    // 연결 상태만 다를 뿐 같은 대화이므로, '정상' 시나리오에서도 방금 보낸 메시지가 보여야 한다.
    const happyPath = createMockChatService({ scenario: 'happy-path' });
    const messages = happyPath.listMessages(COUPLE_ID);
    expect(messages.some((m) => m.body === '연결 끊김에서 보낸 메시지')).toBe(true);

    // AI 준비 중/AI 장애 시나리오에서도 마찬가지로 같은 대화가 보여야 한다.
    const aiWarmingUp = createMockChatService({ scenario: 'ai-warming-up' });
    expect(
      aiWarmingUp.listMessages(COUPLE_ID).some((m) => m.body === '연결 끊김에서 보낸 메시지'),
    ).toBe(true);
  });
});

describe('chatService — 신규 체험 커플은 빈 대화로 시작한다', () => {
  it('시드 메시지를 돌려주지 않는다', () => {
    const service = createMockChatService({ scenario: 'happy-path' });
    expect(service.listMessages('trial-couple-1')).toEqual([]);
    // 검토 커플은 그대로 시드 대화가 있다.
    expect(service.listMessages(COUPLE_ID).length).toBeGreaterThan(0);
  });

  it('체험 커플에서 보낸 메시지는 그 커플 저장소에만 저장된다', async () => {
    const service = createMockChatService({ scenario: 'happy-path' });
    await service.sendMessage(
      {
        coupleId: 'trial-couple-1',
        senderId: 'trial-user-a',
        body: '첫 인사',
        clientMessageId: 't1',
      },
      { onPending: () => {} },
    );
    expect(service.listMessages('trial-couple-1').map((m) => m.body)).toEqual(['첫 인사']);
    expect(service.listMessages('trial-couple-2')).toEqual([]);
  });
});
