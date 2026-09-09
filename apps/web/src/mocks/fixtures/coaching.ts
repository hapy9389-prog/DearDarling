import type { CoachingSuggestion } from '../types';
import { COUPLE_ID, TEST_ACCOUNTS } from './accounts';
import { EVIDENCE_MESSAGE_ID } from './messages';

const MINJUN = TEST_ACCOUNTS[0].id;

/**
 * 민준(수신자)에게만 보이는 코칭 제안. 상대의 마음을 단정하지 않고 행동 선택지를 제안하는 문장을 쓴다.
 * evidenceText는 근거 메시지를 사람이 읽기 쉬운 문장으로 인용한 것 — 내부 evidenceMessageIds는
 * 대화 목록에서 해당 말풍선을 강조하는 용도로만 쓰고, 화면 문구에는 노출하지 않는다.
 */
export const SEED_COACHING_SUGGESTION: CoachingSuggestion = {
  id: 'seed-coaching-1',
  coupleId: COUPLE_ID,
  recipientId: MINJUN,
  insight: '서연님이 오늘 좀 힘들었다고 했어요. 무슨 일이 있었는지 먼저 물어볼 수 있어요.',
  evidenceText: '“요즘 좀 힘들었어. 별일 아닌데 그냥 그래”라고 한 부분',
  evidenceMessageIds: [EVIDENCE_MESSAGE_ID],
  alternatives: [
    '혹시 무슨 일 있었어? 얘기하고 싶으면 들어줄게',
    '오늘 많이 힘들었나 보다, 옆에 있어줄게',
  ],
  createdAt: new Date().toISOString(),
};
