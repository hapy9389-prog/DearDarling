import type { ChatMessage, CoachingSuggestion } from '../../mocks/types';

export type CoachingAreaState =
  | { kind: 'loading' }
  | { kind: 'warming-up' }
  | { kind: 'failure' }
  | { kind: 'consent-pending'; reason: 'self' | 'partner' }
  | { kind: 'hidden' }
  | { kind: 'withheld-optout' }
  | { kind: 'idle' }
  /** 신규 체험 모드 — AI 코칭을 제공하지 않는다(0010). 코칭 검토는 민준·서연 예시 모드에서. */
  | { kind: 'trial-unavailable' }
  | { kind: 'ready'; suggestion: CoachingSuggestion };

export function upsertMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const exists = messages.some((m) => m.id === next.id);
  if (!exists) return [...messages, next];
  return messages.map((m) => (m.id === next.id ? next : m));
}

/**
 * "전송 중"/"실패"는 보낸 사람의 로컬(낙관적) 상태일 뿐, 서버에 저장된 적이 없다.
 * 그래서 보낸 사람 본인에게는 모든 상태를 보여주되, 상대방에게는 "저장 완료"된 메시지만 보여준다 —
 * 실제 서버라면 저장되기 전 상태는 상대방에게 애초에 전달될 수 없는 것과 같은 규칙이다.
 */
export function filterVisibleMessages(messages: ChatMessage[], viewerId: string): ChatMessage[] {
  return messages.filter((m) => m.senderId === viewerId || m.status === 'saved');
}

/**
 * 코칭 분석은 저장이 확정된 메시지만 근거로 삼는다 — 전송 중이거나 실패한(아직 서버에
 * 존재하지 않는 것과 같은) 메시지를 근거로 코칭을 만들면, 실패해서 사라질 수도 있는 내용을
 * 근거로 조언하게 된다.
 */
export function selectSavedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.status === 'saved');
}
