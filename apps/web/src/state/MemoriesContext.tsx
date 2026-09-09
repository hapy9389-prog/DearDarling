import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  createMockMemoriesService,
  type SavedMessageInput,
} from '../mocks/services/memoriesService';
import type { Memory, MemorySuggestion, RememberWhen } from '../mocks/types';
import { useActiveAccount } from './ActiveAccountContext';

const memoriesService = createMockMemoriesService();

/**
 * 추억(직접 저장 + AI 발견) · '그때의 우리' 리마인드를 전역으로 들고 있는 컨텍스트.
 *
 * 추억 탭은 열 때마다 다시 마운트되지만(0003 §3), **대화 화면은 상시 마운트**라 추억 탭에서 삭제한
 * 결과를 대화 화면의 '추억에 저장됨' 배지·중복 방지에 스스로 반영하지 못한다. 또 DevPanel 검토 토글은
 * 오버레이라 추억 탭이 떠 있는 채로 눌린다. 두 경우 모두 재마운트로 갱신되지 않으므로
 * (SettingsContext·PatternContext와 같은 이유) 전역 컨텍스트로 둔다.
 *
 * 계정을 전환하면 개인별 데이터(숨긴 제안, 닫은 리마인드)만 다시 계산한다 — 커플 공유 추억과 저장된
 * 숨김·닫기 선택 자체는 건드리지 않는다.
 */
interface MemoriesContextValue {
  memories: Memory[];
  suggestions: MemorySuggestion[];
  rememberWhen: RememberWhen | null;
  suggestionsPresent: boolean;
  rememberWhenEnabled: boolean;

  memoryForMessage: (messageId: string) => Memory | undefined;

  saveMemory: (message: SavedMessageInput, note: string) => Memory | undefined;
  updateNote: (memoryId: string, note: string) => void;
  deleteMemory: (memoryId: string) => void;
  keepSuggestion: (suggestionId: string) => Memory | undefined;
  hideSuggestion: (suggestionId: string) => void;
  dismissRememberWhen: (dismissKey: string) => void;

  setSuggestionsPresent: (present: boolean) => void;
  setRememberWhenEnabled: (enabled: boolean) => void;
}

const MemoriesContext = createContext<MemoriesContextValue | null>(null);

export function MemoriesProvider({ children }: { children: ReactNode }) {
  const { account } = useActiveAccount();
  const coupleId = account.coupleId;

  const [memories, setMemories] = useState<Memory[]>(() => memoriesService.listMemories(coupleId));
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>(() =>
    memoriesService.listSuggestions(coupleId, account.id),
  );
  const [rememberWhen, setRememberWhen] = useState<RememberWhen | null>(() =>
    memoriesService.getRememberWhen(coupleId, account.id),
  );
  const [suggestionsPresent, setSuggestionsPresentState] = useState(() =>
    memoriesService.getSuggestionsPresent(),
  );
  const [rememberWhenEnabled, setRememberWhenEnabledState] = useState(() =>
    memoriesService.getRememberWhenEnabled(),
  );

  // 계정을 전환하면 개인별 파생 목록만 즉시 다시 읽는다(커플 공유 memories는 그대로).
  const [loadedAccountId, setLoadedAccountId] = useState(account.id);
  if (loadedAccountId !== account.id) {
    setLoadedAccountId(account.id);
    setSuggestions(memoriesService.listSuggestions(coupleId, account.id));
    setRememberWhen(memoriesService.getRememberWhen(coupleId, account.id));
  }

  const value = useMemo<MemoriesContextValue>(() => {
    function syncDerived(nextMemories: Memory[]) {
      setMemories(nextMemories);
      setSuggestions(memoriesService.listSuggestions(coupleId, account.id));
      setRememberWhen(memoriesService.getRememberWhen(coupleId, account.id));
    }

    return {
      memories,
      suggestions,
      rememberWhen,
      suggestionsPresent,
      rememberWhenEnabled,

      memoryForMessage: (messageId) =>
        memories.find((memory) => memory.sourceMessageId === messageId),

      saveMemory: (message, note) => {
        const next = memoriesService.saveMemory({
          coupleId,
          savedByUserId: account.id,
          message,
          note,
        });
        syncDerived(next);
        return next.find((memory) => memory.sourceMessageId === message.id);
      },
      updateNote: (memoryId, note) => {
        syncDerived(memoriesService.updateNote({ coupleId, memoryId, userId: account.id, note }));
      },
      deleteMemory: (memoryId) => {
        syncDerived(memoriesService.deleteMemory({ coupleId, memoryId, userId: account.id }));
      },
      keepSuggestion: (suggestionId) => {
        const target = memoriesService
          .listSuggestions(coupleId, account.id)
          .find((suggestion) => suggestion.id === suggestionId);
        const next = memoriesService.keepSuggestion({
          coupleId,
          userId: account.id,
          suggestionId,
        });
        syncDerived(next);
        return target
          ? next.find((memory) => memory.sourceMessageId === target.sourceMessageId)
          : undefined;
      },
      hideSuggestion: (suggestionId) => {
        memoriesService.hideSuggestion(coupleId, account.id, suggestionId);
        setSuggestions(memoriesService.listSuggestions(coupleId, account.id));
      },
      dismissRememberWhen: (dismissKey) => {
        memoriesService.dismissRememberWhen(coupleId, account.id, dismissKey);
        setRememberWhen(memoriesService.getRememberWhen(coupleId, account.id));
      },

      setSuggestionsPresent: (present) => {
        memoriesService.setSuggestionsPresent(present);
        setSuggestionsPresentState(present);
        setSuggestions(memoriesService.listSuggestions(coupleId, account.id));
      },
      setRememberWhenEnabled: (enabled) => {
        memoriesService.setRememberWhenEnabled(enabled);
        setRememberWhenEnabledState(enabled);
        setRememberWhen(memoriesService.getRememberWhen(coupleId, account.id));
      },
    };
  }, [
    memories,
    suggestions,
    rememberWhen,
    suggestionsPresent,
    rememberWhenEnabled,
    coupleId,
    account.id,
  ]);

  return <MemoriesContext.Provider value={value}>{children}</MemoriesContext.Provider>;
}

export function useMemories(): MemoriesContextValue {
  const ctx = useContext(MemoriesContext);
  if (!ctx) throw new Error('useMemories는 MemoriesProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
