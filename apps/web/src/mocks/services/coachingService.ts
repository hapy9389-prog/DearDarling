import type { ChatMessage, ChatDevScenario, CoachingSuggestion } from '../types';
import { mockDelay } from '../delay';
import { SEED_COACHING_SUGGESTION } from '../fixtures/coaching';

export type CoachingResult =
  | { status: 'warming-up' }
  | { status: 'failure' }
  | { status: 'none' }
  | { status: 'ready'; suggestion: CoachingSuggestion };

export interface CoachingService {
  getSuggestion(params: {
    recipientId: string;
    scenario: ChatDevScenario;
    availableMessages: ChatMessage[];
  }): Promise<CoachingResult>;
}

export function createMockCoachingService(): CoachingService {
  return {
    async getSuggestion({ recipientId, scenario, availableMessages }) {
      if (scenario === 'ai-warming-up') return { status: 'warming-up' };

      await mockDelay(500);

      if (scenario === 'ai-failure') return { status: 'failure' };

      const candidate = SEED_COACHING_SUGGESTION;
      if (candidate.recipientId !== recipientId) return { status: 'none' };

      // 서버가 근거 메시지가 실제 입력(현재 대화)에 있는지 검증하는 규칙을 흉내낸다.
      // 대화를 초기화했거나 빈 대화 시나리오에서는 근거가 없으므로 제안하지 않는다.
      const evidenceExists = candidate.evidenceMessageIds.every((id) =>
        availableMessages.some((m) => m.id === id),
      );
      if (!evidenceExists) return { status: 'none' };

      return { status: 'ready', suggestion: candidate };
    },
  };
}
