import type { ChatMessage, ChatDevScenario, CoachingSuggestion } from '../types';
import { mockDelay } from '../delay';
import { SEED_COACHING_SUGGESTIONS } from '../fixtures/coaching';

export type CoachingResult =
  | { status: 'warming-up' }
  | { status: 'failure' }
  | { status: 'none' }
  | { status: 'withheld-optout' }
  | { status: 'ready'; suggestion: CoachingSuggestion };

export interface CoachingService {
  getSuggestion(params: {
    recipientId: string;
    scenario: ChatDevScenario;
    availableMessages: ChatMessage[];
    /**
     * 코칭 활용이 중단된 주간 관찰 id 목록. 제안이 그 중 하나에서 비롯됐다면
     * (한 명이라도 중단했으면) 제안 대신 'withheld-optout'을 돌려준다(docs/decisions/0004 §5).
     */
    excludedPatternIds: string[];
  }): Promise<CoachingResult>;
}

export function createMockCoachingService(): CoachingService {
  return {
    async getSuggestion({ recipientId, scenario, availableMessages, excludedPatternIds }) {
      if (scenario === 'ai-warming-up') return { status: 'warming-up' };

      await mockDelay(500);

      if (scenario === 'ai-failure') return { status: 'failure' };

      const candidate = SEED_COACHING_SUGGESTIONS.find((s) => s.recipientId === recipientId);
      if (!candidate) return { status: 'none' };

      // 관찰 코칭 활용 중단 → 실제 제안 순서(0004 §5). 근거 존재 확인보다 먼저 본다.
      // 한쪽이 관찰을 제외하면 그 관찰에 연결된 제안은 수신자가 누구든(양쪽) 빠진다.
      if (candidate.sourcePatternId && excludedPatternIds.includes(candidate.sourcePatternId)) {
        return { status: 'withheld-optout' };
      }

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
