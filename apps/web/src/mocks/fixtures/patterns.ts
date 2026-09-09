import type { PatternObservation, WeeklyReport } from '../types';
import { COUPLE_ID, TEST_ACCOUNTS } from './accounts';
import { EVIDENCE_MESSAGE_ID } from './messages';

const MINJUN = TEST_ACCOUNTS[0].id;
const SEOYEON = TEST_ACCOUNTS[1].id;

/** 리포트가 다루는 주의 월요일(고정 시드). 화면에는 절대 날짜를 크게 노출하지 않는다. */
export const SEED_WEEK_OF = '2026-09-07';

const SEEDED_AT = '2026-09-08T09:00:00.000Z';

/**
 * 상태별 시드 관찰(docs/decisions/0004 §7, 0007):
 * - pat-1: 이번 주 **대표 발견**(SEED_WEEKLY_REPORT.headlineObservationId). title·interpretation·
 *   evidenceQuotes로 풍부하게 채운다. **SEED_COACHING_SUGGESTIONS(양측)가 이 관찰에 연결된다** —
 *   기본 상태에서 대화 코칭이 정상 동작하고, 리뷰어가 이 관찰의 코칭 활용 중단을 켜서
 *   "두 계정 코칭에 반영되는 흐름"과 "대표 발견의 실천 제안 가림"을 함께 검토한다.
 * - pat-2: 한쪽(민준)만 의견을 남김.
 * - pat-3: 두 사람이 의견을 남김(중립적으로 나란히 표시, "해석이 갈렸다"로 라벨링하지 않음).
 * - pat-4: 서연이 코칭 활용을 중단함(이미 제외된 표시 상태 검토용).
 *
 * observation 문구는 확정된 사실처럼 들리지 않게 관찰형으로만 쓴다. 잠정 안내는 '우리' 탭 상단에서
 * 한 번만 한다(0007 — 카드별 '미확인 가설' 칩 제거).
 */
export const SEED_PATTERN_OBSERVATIONS: PatternObservation[] = [
  {
    id: 'pat-1',
    coupleId: COUPLE_ID,
    weekOf: SEED_WEEK_OF,
    title: '무거운 대화를 한 번에 끝내지 않아요',
    observation:
      '힘든 얘기가 나온 날은 대화를 짧게 맺고, 며칠 뒤에 그 얘기를 다시 꺼낸 적이 있었어요.',
    interpretation: [
      '당장 깊게 들어가기보다 서로에게 시간을 두는 방식일 수 있어요.',
      '다시 꺼낸 쪽도 받아준 쪽도 그 사이 마음을 정리할 여유가 있었던 것으로 보여요.',
    ],
    evidenceText: '“요즘 좀 힘들었어. 별일 아닌데 그냥 그래”에 “오늘은 일단 좀 쉬자”로 답한 부분',
    evidenceQuotes: [
      '“요즘 좀 힘들었어. 별일 아닌데 그냥 그래”에 “오늘은 일단 좀 쉬자”로 답하고 그날 대화를 짧게 맺은 부분',
      '며칠 뒤 “저번에 힘들다고 했잖아, 지금은 좀 괜찮아?”라고 먼저 물어본 부분',
    ],
    flow: ['힘든 얘기', '그날은 짧게', '며칠 뒤 다시'],
    evidenceMessageIds: [EVIDENCE_MESSAGE_ID],
    suggestion: '다음 날 짧게 “그때 얘기 더 해도 돼”라고 먼저 열어두면 이어가기 편해요.',
    opinions: [],
    coachingOptOuts: [],
  },
  {
    id: 'pat-2',
    coupleId: COUPLE_ID,
    weekOf: SEED_WEEK_OF,
    observation:
      '약속을 잡을 때 한 사람이 먼저 날짜를 제안하고 다른 사람이 맞추는 장면이 잦았어요.',
    evidenceText: '주말 계획을 얘기하며 “토요일 어때?”로 시작한 부분',
    suggestion: '가끔 “언제가 편해?”로 먼저 물어보면 두 사람의 부담이 더 고르게 나뉘어요.',
    evidenceMessageIds: [],
    opinions: [
      {
        id: 'op-1',
        authorId: MINJUN,
        text: '내가 날짜를 잘 던지는 편이긴 해. 서연이도 편한 날 있으면 먼저 말해줘도 좋아.',
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ],
    coachingOptOuts: [],
  },
  {
    id: 'pat-3',
    coupleId: COUPLE_ID,
    weekOf: SEED_WEEK_OF,
    observation: '대화가 길어지면 이모지로 마무리하고 다음 주제로 넘어가는 경우가 많았어요.',
    evidenceText: '“ㅇㅇ 고마워 🥲”로 대화를 맺은 부분',
    suggestion: '가끔은 한 줄 더 붙여 마음을 확인하면 서로 여운이 남아요.',
    evidenceMessageIds: [],
    opinions: [
      {
        id: 'op-2',
        authorId: MINJUN,
        text: '이모지로 끝내는 게 편해서 자주 그러는 것 같아.',
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
      {
        id: 'op-3',
        authorId: SEOYEON,
        text: '나는 대화가 잘 마무리됐다는 신호로 받아들였어.',
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    ],
    coachingOptOuts: [],
  },
  {
    id: 'pat-4',
    coupleId: COUPLE_ID,
    weekOf: SEED_WEEK_OF,
    observation: '서로 피곤한 날에는 답이 짧아지고 대화를 빨리 정리하는 장면이 있었어요.',
    evidenceText: '“아니 아직... 입맛도 없고”처럼 짧게 답한 부분',
    suggestion:
      '피곤한 날은 “지금은 힘들어서 내일 얘기하자”처럼 상태를 먼저 알려주면 오해가 줄어요.',
    evidenceMessageIds: [],
    opinions: [],
    coachingOptOuts: [{ userId: SEOYEON, createdAt: SEEDED_AT }],
  },
];

export const SEED_WEEKLY_REPORT: WeeklyReport = {
  coupleId: COUPLE_ID,
  weekOf: SEED_WEEK_OF,
  deliveredAt: '2026-09-07T00:10:00.000Z',
  // 대표 발견은 pat-1. 실제 분석에서 눈에 띄는 관찰이 없으면 null로 두고 억지로 만들지 않는다(0007).
  headlineObservationId: 'pat-1',
  stats: {
    totalMessages: 214,
    daysWithConversation: 7,
    activeDaysTotal: 7,
    byWeekday: [
      { weekday: '월', count: 26 },
      { weekday: '화', count: 31 },
      { weekday: '수', count: 22 },
      { weekday: '목', count: 28 },
      { weekday: '금', count: 40 },
      { weekday: '토', count: 39 },
      { weekday: '일', count: 28 },
    ],
    // 통계로 뒷받침되는 범위만 — 시간대('저녁') 같은 근거 없는 단정은 쓰지 않는다(0007).
    highlights: [
      '금요일에 주고받은 메시지가 가장 많았어요.',
      '“고생했다”, “고마워”처럼 서로를 다독이는 말이 자주 오갔어요.',
    ],
  },
};
