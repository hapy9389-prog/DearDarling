import type { ConsultationPrompt } from '../types';
import { mockDelay } from '../delay';
import { SEED_CONSULTATION_PROMPTS } from '../fixtures/consultation';

/**
 * '우리' 탭 → 'AI에게 물어보기'의 개인 상담(개인 채널).
 * 이번 단계는 **화면 검토용 예시**다 — 실제 AI 답변이 아니고, 상담 내용은 상대·공유 리포트에
 * 자동 공개되지 않는다. 아무것도 영속 저장하지 않는다(계정 전환 시 화면에서 초기화).
 * 실제 대화를 분석하는 상담의 동의 정책은 이후 결정 사항(0005 계열)으로 남겨 둔다.
 */
export interface ConsultationService {
  listPrompts(): ConsultationPrompt[];
  /** 예시 질문 id로 시드 답변을 돌려준다(서버 왕복처럼 잠깐 지연). */
  ask(promptId: string): Promise<string>;
}

export function createMockConsultationService(): ConsultationService {
  return {
    listPrompts() {
      return SEED_CONSULTATION_PROMPTS;
    },
    async ask(promptId) {
      await mockDelay(600);
      const prompt = SEED_CONSULTATION_PROMPTS.find((candidate) => candidate.id === promptId);
      if (!prompt) throw new Error(`알 수 없는 예시 질문입니다: ${promptId}`);
      return prompt.answer;
    },
  };
}
