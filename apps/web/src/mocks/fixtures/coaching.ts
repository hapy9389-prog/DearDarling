import type { CoachingSuggestion } from '../types';
import { COUPLE_ID, TEST_ACCOUNTS } from './accounts';
import { EVIDENCE_MESSAGE_ID } from './messages';

const MINJUN = TEST_ACCOUNTS[0].id;
const SEOYEON = TEST_ACCOUNTS[1].id;

/**
 * 수신자별 코칭 제안. 상대의 마음을 단정하지 않고 행동 선택지를 제안하는 문장을 쓴다.
 * evidenceText는 근거 메시지를 사람이 읽기 쉬운 문장으로 인용한 것 — 내부 evidenceMessageIds는
 * 대화 목록에서 해당 말풍선을 강조하는 용도로만 쓰고, 화면 문구에는 노출하지 않는다.
 *
 * 두 제안 모두 '우리' 탭의 주간 관찰 `pat-1`에서 비롯됐다(`sourcePatternId`). 민준이든 서연이든
 * 누구든 그 관찰의 코칭 활용을 중단하면, **두 사람 모두의** 대화 코칭에서 이 제안이 빠진다
 * (docs/decisions/0004 §5).
 */
export const SEED_COACHING_SUGGESTIONS: CoachingSuggestion[] = [
  {
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
    sourcePatternId: 'pat-1',
  },
  {
    id: 'seed-coaching-2',
    coupleId: COUPLE_ID,
    recipientId: SEOYEON,
    insight:
      '민준님이 “오늘은 일단 좀 쉬자”라고 했어요. 지금 더 얘기하기보다 쉬고 싶다는 뜻일 수 있어요.',
    evidenceText: '“그렇구나. 오늘은 일단 좀 쉬자”라고 한 부분',
    evidenceMessageIds: ['seed-msg-5'],
    alternatives: ['응 오늘은 좀 쉬자. 내일 다시 얘기해도 돼?', '알겠어, 필요하면 편하게 말해줘'],
    createdAt: new Date().toISOString(),
    sourcePatternId: 'pat-1',
  },
];
