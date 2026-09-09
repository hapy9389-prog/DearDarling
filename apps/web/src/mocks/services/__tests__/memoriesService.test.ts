import { afterEach, describe, expect, it } from 'vitest';
import { createMockMemoriesService } from '../memoriesService';
import { createMockChatService } from '../chatService';
import { COUPLE_ID, TEST_ACCOUNTS } from '../../fixtures/accounts';
import { SEED_MESSAGES } from '../../fixtures/messages';
import { coupleKey, readJSON, resetAllMockData } from '../../storage';
import type { ChatMessage } from '../../types';

const MINJUN = TEST_ACCOUNTS[0].id;
const SEOYEON = TEST_ACCOUNTS[1].id;

const service = createMockMemoriesService();

function seedMessage(id: string): ChatMessage {
  const found = SEED_MESSAGES.find((m) => m.id === id);
  if (!found) throw new Error(`시드 메시지 없음: ${id}`);
  return found;
}

afterEach(() => {
  resetAllMockData();
});

describe('memoriesService — 직접 저장', () => {
  it('저장이 끝나지 않은 메시지는 거부한다', () => {
    const sending: ChatMessage = { ...seedMessage('seed-msg-1'), id: 'x', status: 'sending' };
    expect(() =>
      service.saveMemory({ coupleId: COUPLE_ID, savedByUserId: MINJUN, message: sending }),
    ).toThrow(/전송이 끝난 메시지/);
  });

  it('같은 메시지는 중복 저장할 수 없다', () => {
    service.saveMemory({
      coupleId: COUPLE_ID,
      savedByUserId: MINJUN,
      message: seedMessage('seed-msg-1'),
    });
    expect(() =>
      service.saveMemory({
        coupleId: COUPLE_ID,
        savedByUserId: SEOYEON,
        message: seedMessage('seed-msg-1'),
      }),
    ).toThrow(/이미 추억으로 간직한/);
  });

  it('저장 시점 스냅샷을 남긴다', () => {
    service.saveMemory({
      coupleId: COUPLE_ID,
      savedByUserId: MINJUN,
      message: seedMessage('seed-msg-1'),
      note: '  메모  ',
    });
    const saved = service.listMemories(COUPLE_ID).find((m) => m.sourceMessageId === 'seed-msg-1');
    expect(saved?.quoteBody).toBe('오늘 회의 진짜 길었어 ㅠㅠ');
    expect(saved?.quoteSenderId).toBe(SEOYEON);
    expect(saved?.note).toBe('메모');
    expect(saved?.savedByUserId).toBe(MINJUN);
  });
});

describe('memoriesService — 메모 수정/삭제 권한', () => {
  function saveOne() {
    service.saveMemory({
      coupleId: COUPLE_ID,
      savedByUserId: MINJUN,
      message: seedMessage('seed-msg-1'),
    });
    return service.listMemories(COUPLE_ID)[0]!;
  }

  it('저장한 사람만 메모를 수정할 수 있고, savedAt·순서는 바뀌지 않는다', () => {
    service.saveMemory({
      coupleId: COUPLE_ID,
      savedByUserId: MINJUN,
      message: seedMessage('seed-msg-2'),
    });
    const older = service
      .saveMemory({
        coupleId: COUPLE_ID,
        savedByUserId: MINJUN,
        message: seedMessage('seed-msg-1'),
      })
      .find((m) => m.sourceMessageId === 'seed-msg-1')!;

    expect(() =>
      service.updateNote({
        coupleId: COUPLE_ID,
        memoryId: older.id,
        userId: SEOYEON,
        note: '침입',
      }),
    ).toThrow(/저장한 사람만/);

    const before = service.listMemories(COUPLE_ID).map((m) => m.id);
    const savedAtBefore = older.savedAt;
    service.updateNote({
      coupleId: COUPLE_ID,
      memoryId: older.id,
      userId: MINJUN,
      note: '새 메모',
    });
    const after = service.listMemories(COUPLE_ID);
    expect(after.map((m) => m.id)).toEqual(before);
    const updated = after.find((m) => m.id === older.id)!;
    expect(updated.note).toBe('새 메모');
    expect(updated.savedAt).toBe(savedAtBefore);
    expect(updated.noteUpdatedAt).toBeDefined();
  });

  it('저장한 사람만 삭제할 수 있고, 원래 대화 메시지는 지우지 않는다', () => {
    // 시드 대화를 localStorage에 실체화한다.
    const chat = createMockChatService({ scenario: 'happy-path' });
    chat.listMessages(COUPLE_ID);
    const messagesKey = coupleKey(COUPLE_ID, 'messages');

    const one = saveOne();
    expect(() =>
      service.deleteMemory({ coupleId: COUPLE_ID, memoryId: one.id, userId: SEOYEON }),
    ).toThrow(/저장한 사람만/);

    const messagesBefore = readJSON<ChatMessage[]>(messagesKey, []);
    service.deleteMemory({ coupleId: COUPLE_ID, memoryId: one.id, userId: MINJUN });
    expect(service.getMemory(COUPLE_ID, one.id)).toBeUndefined();
    expect(readJSON<ChatMessage[]>(messagesKey, [])).toEqual(messagesBefore);

    // 삭제 후 다시 저장하면 새 추억(새 id·새 savedAt)이 만들어진다.
    const again = service
      .saveMemory({
        coupleId: COUPLE_ID,
        savedByUserId: MINJUN,
        message: seedMessage('seed-msg-1'),
      })
      .find((m) => m.sourceMessageId === 'seed-msg-1')!;
    expect(again.id).not.toBe(one.id);
  });
});

describe('memoriesService — AI 발견 순간', () => {
  it("'숨기기'는 개인 적용 — 상대의 발견 목록에는 남는다", () => {
    const first = service.listSuggestions(COUPLE_ID, MINJUN);
    expect(first.length).toBeGreaterThan(0);
    const hiddenId = first[0]!.id;
    const memoriesBefore = service.listMemories(COUPLE_ID).length;

    service.hideSuggestion(COUPLE_ID, MINJUN, hiddenId);
    expect(service.listSuggestions(COUPLE_ID, MINJUN).map((s) => s.id)).not.toContain(hiddenId);
    expect(service.listSuggestions(COUPLE_ID, SEOYEON).map((s) => s.id)).toContain(hiddenId);
    // 저장된 추억은 건드리지 않는다.
    expect(service.listMemories(COUPLE_ID)).toHaveLength(memoriesBefore);
  });

  it("'간직하기'는 커플 공유 추억으로 저장하고 목록에서 사라진다", () => {
    const suggestion = service.listSuggestions(COUPLE_ID, MINJUN)[0]!;
    service.keepSuggestion({ coupleId: COUPLE_ID, userId: MINJUN, suggestionId: suggestion.id });

    const saved = service
      .listMemories(COUPLE_ID)
      .find((m) => m.sourceMessageId === suggestion.sourceMessageId);
    expect(saved?.fromSuggestion).toBe(true);
    // 이제 두 사람 모두의 발견 목록에서 빠진다(이미 저장된 메시지라서).
    expect(service.listSuggestions(COUPLE_ID, MINJUN).map((s) => s.id)).not.toContain(
      suggestion.id,
    );
    expect(service.listSuggestions(COUPLE_ID, SEOYEON).map((s) => s.id)).not.toContain(
      suggestion.id,
    );
  });

  it('간직한 뒤 그 추억을 삭제하면 같은 제안이 다시 보이지만, 자동 저장되지는 않는다', () => {
    const baseline = service.listMemories(COUPLE_ID).length;
    const suggestion = service.listSuggestions(COUPLE_ID, MINJUN)[0]!;
    service.keepSuggestion({ coupleId: COUPLE_ID, userId: MINJUN, suggestionId: suggestion.id });
    const saved = service
      .listMemories(COUPLE_ID)
      .find((m) => m.sourceMessageId === suggestion.sourceMessageId)!;
    service.deleteMemory({ coupleId: COUPLE_ID, memoryId: saved.id, userId: MINJUN });

    expect(service.listSuggestions(COUPLE_ID, MINJUN).map((s) => s.id)).toContain(suggestion.id);
    expect(service.listMemories(COUPLE_ID)).toHaveLength(baseline);
  });

  it("검토 토글 '끔'이면 목록은 비지만 숨김·저장 데이터는 유지된다", () => {
    const suggestion = service.listSuggestions(COUPLE_ID, MINJUN)[0]!;
    service.hideSuggestion(COUPLE_ID, MINJUN, suggestion.id);

    service.setSuggestionsPresent(false);
    expect(service.listSuggestions(COUPLE_ID, MINJUN)).toHaveLength(0);

    service.setSuggestionsPresent(true);
    expect(service.listSuggestions(COUPLE_ID, MINJUN).map((s) => s.id)).not.toContain(
      suggestion.id,
    );
  });
});

describe('memoriesService — 그때의 우리', () => {
  it('평소(끔)에는 시드 대화가 마일스톤에 안 걸려 리마인드가 없다', () => {
    expect(service.getRememberWhen(COUPLE_ID, MINJUN)).toBeNull();
  });

  it("검토 토글 '켬'이면 앵커 추억이 100일로 잡히고, 그 추억을 지우면 다시 사라진다", () => {
    service.setRememberWhenEnabled(true);
    const remind = service.getRememberWhen(COUPLE_ID, MINJUN);
    expect(remind?.match).toBe('exact');
    expect(remind?.phrase).toBe('100일 전 오늘');

    service.deleteMemory({
      coupleId: COUPLE_ID,
      memoryId: remind!.memory.id,
      userId: remind!.memory.savedByUserId,
    });
    expect(service.getRememberWhen(COUPLE_ID, MINJUN)).toBeNull();
  });

  it("'이 리마인드 닫기'는 개인 적용", () => {
    service.setRememberWhenEnabled(true);
    const remind = service.getRememberWhen(COUPLE_ID, MINJUN)!;
    service.dismissRememberWhen(COUPLE_ID, MINJUN, remind.dismissKey);

    expect(service.getRememberWhen(COUPLE_ID, MINJUN)).toBeNull();
    expect(service.getRememberWhen(COUPLE_ID, SEOYEON)?.dismissKey).toBe(remind.dismissKey);
  });
});
