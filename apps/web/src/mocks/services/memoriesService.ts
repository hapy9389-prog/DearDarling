import type { ChatMessage, Memory, MemorySuggestion, RememberWhen } from '../types';
import {
  REMEMBER_WHEN_ANCHOR_MEMORY_ID,
  REMEMBER_WHEN_ANCHOR_MILESTONE_DAYS,
  SEED_MEMORIES,
  SEED_MEMORY_SUGGESTIONS,
} from '../fixtures/memories';
import { pickRememberWhen, sortBySavedNewest, visibleSuggestions } from '../domain/memories';
import { coupleKey, devKey, readJSON, userKey, writeJSON } from '../storage';

/**
 * 추억(직접 저장 + AI 발견 '간직하기')과 '그때의 우리' 리마인드를 다루는 커플 단위 서비스
 * (docs/decisions/0008).
 *
 * - 저장된 추억은 두 사람이 함께 보는 데이터라 coupleKey에 둔다. 분석 동의(개인·userKey)와 무관하게 유지된다.
 * - AI 발견 제안의 '숨기기'는 **개인** 적용이라 userKey에 둔다 — 상대의 발견 목록에는 그대로 남는다.
 * - '그때의 우리' 닫기도 개인 적용이며, "그 추억 + 그 마일스톤" 조합만 닫는다(다른 마일스톤은 계속 뜬다).
 * - 검토 도구 토글(제안 표시 / 리마인드 예시)은 devKey에 두며, 저장된 추억·숨김·닫기 데이터를 바꾸지 않는다.
 *
 * 실제 자동 분석·주기적 생성·사진 업로드·DB 저장은 후속 단계다 — 여기서는 시드 예시로만 검토한다.
 * 실제 API가 생기면 이 인터페이스의 구현체만 HTTP 호출로 교체하면 된다.
 */

export type SavedMessageInput = Pick<
  ChatMessage,
  'id' | 'body' | 'senderId' | 'createdAt' | 'status'
>;

export interface SaveMemoryInput {
  coupleId: string;
  savedByUserId: string;
  message: SavedMessageInput;
  note?: string;
}

export interface UpdateNoteInput {
  coupleId: string;
  memoryId: string;
  userId: string;
  note: string;
}

export interface DeleteMemoryInput {
  coupleId: string;
  memoryId: string;
  userId: string;
}

export interface KeepSuggestionInput {
  coupleId: string;
  userId: string;
  suggestionId: string;
}

export interface MemoriesService {
  listMemories(coupleId: string): Memory[];
  getMemory(coupleId: string, memoryId: string): Memory | undefined;
  findBySourceMessage(coupleId: string, messageId: string): Memory | undefined;
  /**
   * 저장소에 id가 없는 시드 추억만 덧붙인다(검토 도구 전용). 사용자가 저장·수정한 추억이나
   * 이미 있는 시드는 건드리지 않는다 — 자동 파생이 아니라 리뷰어가 명시적으로 부르는 일회성 동작.
   */
  seedMissingMemories(coupleId: string): Memory[];
  saveMemory(input: SaveMemoryInput): Memory[];
  updateNote(input: UpdateNoteInput): Memory[];
  deleteMemory(input: DeleteMemoryInput): Memory[];

  listSuggestions(coupleId: string, userId: string): MemorySuggestion[];
  hideSuggestion(coupleId: string, userId: string, suggestionId: string): void;
  keepSuggestion(input: KeepSuggestionInput): Memory[];

  getRememberWhen(coupleId: string, userId: string): RememberWhen | null;
  dismissRememberWhen(coupleId: string, userId: string, dismissKey: string): void;

  getSuggestionsPresent(): boolean;
  setSuggestionsPresent(present: boolean): void;
  getRememberWhenEnabled(): boolean;
  setRememberWhenEnabled(enabled: boolean): void;
}

function memoriesKey(coupleId: string): string {
  return coupleKey(coupleId, 'memories');
}
function hiddenSuggestionsKey(userId: string): string {
  return userKey(userId, 'hiddenMemorySuggestions');
}
function dismissedRememberWhenKey(userId: string): string {
  return userKey(userId, 'dismissedRememberWhen');
}
const SUGGESTIONS_PRESENT_KEY = devKey('memorySuggestionsPresent');
const REMEMBER_WHEN_ENABLED_KEY = devKey('rememberWhenEnabled');

/** 저장소를 읽어 시드가 아닌 독립된 사본을 돌려준다(시드 상수를 실수로 변형하지 않도록). */
function load(coupleId: string): Memory[] {
  const raw = readJSON<Memory[]>(memoriesKey(coupleId), SEED_MEMORIES);
  return raw.map((memory) => ({
    ...memory,
    images: memory.images ? memory.images.map((image) => ({ ...image })) : undefined,
  }));
}

function save(coupleId: string, memories: Memory[]): Memory[] {
  writeJSON(memoriesKey(coupleId), memories);
  return sortBySavedNewest(memories);
}

function createMemoryFrom(input: SaveMemoryInput, extra: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    coupleId: input.coupleId,
    savedByUserId: input.savedByUserId,
    savedAt: now,
    note: input.note?.trim() ? input.note.trim() : undefined,
    noteUpdatedAt: input.note?.trim() ? now : undefined,
    sourceMessageId: input.message.id,
    quoteBody: input.message.body,
    quoteSenderId: input.message.senderId,
    conversationAt: input.message.createdAt,
    ...extra,
  };
}

export function createMockMemoriesService(): MemoriesService {
  return {
    listMemories(coupleId) {
      return sortBySavedNewest(load(coupleId));
    },

    getMemory(coupleId, memoryId) {
      return load(coupleId).find((memory) => memory.id === memoryId);
    },

    findBySourceMessage(coupleId, messageId) {
      return load(coupleId).find((memory) => memory.sourceMessageId === messageId);
    },

    seedMissingMemories(coupleId) {
      const stored = load(coupleId);
      const haveIds = new Set(stored.map((memory) => memory.id));
      // sourceMessageId도 확인한다 — 예시를 지우고 같은 메시지를 사용자가 다시 저장했다면(다른 id로)
      // 그 메시지는 이미 추억이 하나 있으므로 시드를 또 넣지 않는다(메시지당 추억 1개 규칙).
      const haveSourceMessages = new Set(stored.map((memory) => memory.sourceMessageId));
      const missing = SEED_MEMORIES.filter(
        (memory) =>
          memory.coupleId === coupleId &&
          !haveIds.has(memory.id) &&
          !haveSourceMessages.has(memory.sourceMessageId),
      ).map((memory) => ({
        ...memory,
        images: memory.images ? memory.images.map((image) => ({ ...image })) : undefined,
      }));
      if (missing.length === 0) return sortBySavedNewest(stored);
      return save(coupleId, [...stored, ...missing]);
    },

    saveMemory(input) {
      if (input.message.status !== 'saved') {
        throw new Error('전송이 끝난 메시지만 추억으로 저장할 수 있어요.');
      }
      const memories = load(input.coupleId);
      if (memories.some((memory) => memory.sourceMessageId === input.message.id)) {
        throw new Error('이미 추억으로 간직한 메시지예요.');
      }
      return save(input.coupleId, [...memories, createMemoryFrom(input)]);
    },

    updateNote({ coupleId, memoryId, userId, note }) {
      const memories = load(coupleId);
      const target = memories.find((memory) => memory.id === memoryId);
      if (!target) throw new Error(`추억을 찾을 수 없어요: ${memoryId}`);
      if (target.savedByUserId !== userId) {
        throw new Error('추억을 저장한 사람만 메모를 수정할 수 있어요.');
      }
      const trimmed = note.trim();
      const next = memories.map((memory) =>
        memory.id === memoryId
          ? {
              ...memory,
              // 메모만 바꾼다 — savedAt은 그대로 두어 목록 순서·저장일 구분선이 움직이지 않는다.
              note: trimmed ? trimmed : undefined,
              noteUpdatedAt: trimmed ? new Date().toISOString() : undefined,
            }
          : memory,
      );
      return save(coupleId, next);
    },

    deleteMemory({ coupleId, memoryId, userId }) {
      const memories = load(coupleId);
      const target = memories.find((memory) => memory.id === memoryId);
      if (!target) throw new Error(`추억을 찾을 수 없어요: ${memoryId}`);
      if (target.savedByUserId !== userId) {
        throw new Error('추억을 저장한 사람만 삭제할 수 있어요.');
      }
      // 추억만 지운다 — 원래 대화 메시지(coupleKey의 messages)는 건드리지 않는다.
      return save(
        coupleId,
        memories.filter((memory) => memory.id !== memoryId),
      );
    },

    listSuggestions(coupleId, userId) {
      if (!readJSON<boolean>(SUGGESTIONS_PRESENT_KEY, true)) return [];
      const hidden = readJSON<string[]>(hiddenSuggestionsKey(userId), []);
      return visibleSuggestions(
        SEED_MEMORY_SUGGESTIONS.filter((suggestion) => suggestion.coupleId === coupleId),
        load(coupleId),
        hidden,
      );
    },

    hideSuggestion(_coupleId, userId, suggestionId) {
      const key = hiddenSuggestionsKey(userId);
      const hidden = readJSON<string[]>(key, []);
      if (!hidden.includes(suggestionId)) writeJSON(key, [...hidden, suggestionId]);
    },

    keepSuggestion({ coupleId, userId, suggestionId }) {
      const suggestion = SEED_MEMORY_SUGGESTIONS.find((entry) => entry.id === suggestionId);
      if (!suggestion) throw new Error(`발견한 순간을 찾을 수 없어요: ${suggestionId}`);
      const memories = load(coupleId);
      if (memories.some((memory) => memory.sourceMessageId === suggestion.sourceMessageId)) {
        throw new Error('이미 추억으로 간직한 메시지예요.');
      }
      const memory = createMemoryFrom(
        {
          coupleId,
          savedByUserId: userId,
          message: {
            id: suggestion.sourceMessageId,
            body: suggestion.quoteBody,
            senderId: suggestion.quoteSenderId,
            createdAt: suggestion.conversationAt,
            status: 'saved',
          },
        },
        {
          fromSuggestion: true,
          images: suggestion.images ? suggestion.images.map((image) => ({ ...image })) : undefined,
          layout: suggestion.images && suggestion.images.length > 0 ? 'photo' : 'conversation',
        },
      );
      return save(coupleId, [...memories, memory]);
    },

    getRememberWhen(coupleId, userId) {
      const memories = load(coupleId);
      const dismissed = readJSON<string[]>(dismissedRememberWhenKey(userId), []);

      // 검토용: 리마인드 '예시'만 앵커 추억의 대화 날짜 + 100일을 기준 시각으로 삼는다.
      // 실제 저장 날짜·목록 정렬은 이 값과 무관하다.
      let now = new Date();
      if (readJSON<boolean>(REMEMBER_WHEN_ENABLED_KEY, false)) {
        const anchor = memories.find((memory) => memory.id === REMEMBER_WHEN_ANCHOR_MEMORY_ID);
        if (anchor) {
          now = new Date(
            new Date(anchor.conversationAt).getTime() +
              REMEMBER_WHEN_ANCHOR_MILESTONE_DAYS * 86_400_000,
          );
        }
      }
      return pickRememberWhen(memories, dismissed, now);
    },

    dismissRememberWhen(_coupleId, userId, dismissKey) {
      const key = dismissedRememberWhenKey(userId);
      const dismissed = readJSON<string[]>(key, []);
      if (!dismissed.includes(dismissKey)) writeJSON(key, [...dismissed, dismissKey]);
    },

    getSuggestionsPresent() {
      return readJSON<boolean>(SUGGESTIONS_PRESENT_KEY, true);
    },
    setSuggestionsPresent(present) {
      writeJSON(SUGGESTIONS_PRESENT_KEY, present);
    },
    getRememberWhenEnabled() {
      return readJSON<boolean>(REMEMBER_WHEN_ENABLED_KEY, false);
    },
    setRememberWhenEnabled(enabled) {
      writeJSON(REMEMBER_WHEN_ENABLED_KEY, enabled);
    },
  };
}
