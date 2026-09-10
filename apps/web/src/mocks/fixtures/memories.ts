import type { Memory, MemorySuggestion } from '../types';
import { COUPLE_ID, TEST_ACCOUNTS } from './accounts';

const MINJUN = TEST_ACCOUNTS[0].id;
const SEOYEON = TEST_ACCOUNTS[1].id;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * '그때의 우리' 검토용 앵커 추억. 검토 도구에서 '그때의 우리 · 켬'을 누르면 이 추억의 대화 날짜를
 * 기준으로 "100일 전 오늘"이 되도록 리마인드 기준 시각만 덮어쓴다(실제 저장 날짜·정렬은 그대로).
 * 이 추억을 삭제하면 켬이어도 리마인드가 뜨지 않는다.
 */
export const REMEMBER_WHEN_ANCHOR_MEMORY_ID = 'mem-seed-sea';
export const REMEMBER_WHEN_ANCHOR_MILESTONE_DAYS = 100;

/**
 * 커플 `couple-1`의 시드 추억(docs/decisions/0008). 사진 중심·대화 중심 카드가 섞여 보이도록 구성한다.
 * 사진이 붙은 시드는 지금 대화창에 없는 예전 메시지를 인용해, "원본 메시지가 없어도 추억은 유지"되는
 * 경우를 함께 보여준다. 예시 이미지는 실사가 아니라 일러스트이며 화면에 '예시 이미지' 라벨이 붙는다.
 *
 * 예시는 피로·갈등뿐 아니라 여행·농담·함께한 즐거운 순간도 함께 담는다. 정렬 기준(savedAt)은
 * 최신 `mem-seed-talk-1`(1일 전, 대화) + `mem-seed-photo-night`(8일 전, 사진), 최오래 `mem-seed-sea`(20일 전)를
 * 고정으로 두어, 홈의 '최근 추억'이 항상 사진 1 + 대화 1이 되고 기존 정렬 검증이 유지되게 한다.
 */
export const SEED_MEMORIES: Memory[] = [
  {
    id: 'mem-seed-talk-1',
    coupleId: COUPLE_ID,
    savedByUserId: MINJUN,
    savedAt: daysAgoIso(1),
    note: '이날 솔직하게 말해줘서 고마웠어. 다음 날 다시 물어봤지.',
    noteUpdatedAt: daysAgoIso(1),
    sourceMessageId: 'seed-msg-4',
    layout: 'conversation',
    quoteBody: '요즘 좀 힘들었어. 별일 아닌데 그냥 그래',
    quoteSenderId: SEOYEON,
    conversationAt: daysAgoIso(1),
  },
  {
    id: 'mem-seed-photo-night',
    coupleId: COUPLE_ID,
    savedByUserId: SEOYEON,
    savedAt: daysAgoIso(8),
    sourceMessageId: 'archived-msg-night',
    layout: 'photo',
    images: [
      { variant: 'night-talk', alt: '늦은 밤 나란히 앉아 이야기하는 두 사람을 그린 예시 이미지' },
    ],
    quoteBody: '오늘은 그냥 밤새 얘기하자',
    quoteSenderId: SEOYEON,
    conversationAt: daysAgoIso(30),
  },
  {
    id: 'mem-seed-talk-2',
    coupleId: COUPLE_ID,
    savedByUserId: SEOYEON,
    savedAt: daysAgoIso(12),
    sourceMessageId: 'seed-msg-6',
    layout: 'conversation',
    quoteBody: 'ㅇㅇ 고마워 🥲',
    quoteSenderId: SEOYEON,
    conversationAt: daysAgoIso(12),
  },
  {
    id: 'mem-seed-photo-trip',
    coupleId: COUPLE_ID,
    savedByUserId: SEOYEON,
    savedAt: daysAgoIso(10),
    note: '즉흥으로 떠난 1박 2일. 사진보다 그날 실컷 웃은 게 더 기억나.',
    noteUpdatedAt: daysAgoIso(10),
    sourceMessageId: 'archived-msg-trip-train',
    layout: 'photo',
    images: [{ variant: 'trip', alt: '기차 창가에 나란히 앉은 두 사람을 그린 예시 이미지' }],
    quoteBody: '기차에서 먹는 김밥이 왜 이렇게 맛있냐',
    quoteSenderId: SEOYEON,
    conversationAt: daysAgoIso(11),
  },
  {
    id: 'mem-seed-talk-joke',
    coupleId: COUPLE_ID,
    savedByUserId: MINJUN,
    savedAt: daysAgoIso(15),
    sourceMessageId: 'archived-msg-joke-bet',
    layout: 'conversation',
    quoteBody: '내기해서 진 사람이 오늘 설거지 ㅋㅋ 콜?',
    quoteSenderId: MINJUN,
    conversationAt: daysAgoIso(15),
  },
  {
    id: REMEMBER_WHEN_ANCHOR_MEMORY_ID,
    coupleId: COUPLE_ID,
    savedByUserId: MINJUN,
    savedAt: daysAgoIso(20),
    note: '충동적으로 떠난 날. 한참 파도 소리만 들었어.',
    noteUpdatedAt: daysAgoIso(20),
    sourceMessageId: 'archived-msg-sea',
    layout: 'photo',
    images: [{ variant: 'sea', alt: '바다를 보며 나란히 걷는 두 사람을 그린 예시 이미지' }],
    quoteBody: '바다 보러 가자던 말, 진짜 지키게 됐네',
    quoteSenderId: MINJUN,
    conversationAt: daysAgoIso(140),
  },
];

/**
 * AI가 발견한 순간(시드 예시 — 실제 분석 결과가 아니다). SEED_MEMORIES와 겹치지 않는 메시지만 쓴다.
 * `reason`은 관찰형으로만 쓰고 상대의 감정을 단정하지 않는다.
 *
 * 첫 항목(`sug-trip`)이 화면의 '대표' 발견으로 먼저 보이고 나머지는 '발견 더 보기'로 펼친다.
 * 피로·갈등뿐 아니라 여행·감사·농담·즐거운 순간을 함께 담는다.
 */
export const SEED_MEMORY_SUGGESTIONS: MemorySuggestion[] = [
  {
    id: 'sug-trip',
    coupleId: COUPLE_ID,
    sourceMessageId: 'archived-msg-trip-plan',
    quoteBody: '이번엔 진짜 아무 계획 없이 훌쩍 떠나자',
    quoteSenderId: MINJUN,
    conversationAt: daysAgoIso(3),
    reason: '둘 다 신나서 즉흥 여행을 함께 정한 순간이에요.',
    images: [
      { variant: 'trip', alt: '작은 가방을 메고 함께 길을 나서는 두 사람을 그린 예시 이미지' },
    ],
  },
  {
    id: 'sug-thanks',
    coupleId: COUPLE_ID,
    sourceMessageId: 'archived-msg-thanks',
    quoteBody: '지난주에 챙겨줘서 고마웠어. 그때 말 못 했는데',
    quoteSenderId: SEOYEON,
    conversationAt: daysAgoIso(4),
    reason: '고마운 마음을 뒤늦게라도 전한 대화예요.',
  },
  {
    id: 'sug-joke',
    coupleId: COUPLE_ID,
    sourceMessageId: 'archived-msg-joke',
    quoteBody: '너 그 표정 짓지 마 ㅋㅋㅋ 또 시작이야',
    quoteSenderId: MINJUN,
    conversationAt: daysAgoIso(6),
    reason: '사소한 장난으로 같이 웃으며 넘어간 순간이에요.',
  },
  {
    id: 'sug-evening',
    coupleId: COUPLE_ID,
    sourceMessageId: 'seed-msg-2',
    quoteBody: '고생했다 저녁은 먹었어?',
    quoteSenderId: MINJUN,
    conversationAt: daysAgoIso(1),
    reason: '힘든 하루 얘기가 나오자 안부를 먼저 물어본 순간이에요.',
  },
  {
    id: 'sug-rest',
    coupleId: COUPLE_ID,
    sourceMessageId: 'seed-msg-5',
    quoteBody: '그렇구나. 오늘은 일단 좀 쉬자',
    quoteSenderId: MINJUN,
    conversationAt: daysAgoIso(1),
    reason: '더 캐묻지 않고 그날은 쉬어가자고 받아준 대화였어요.',
  },
  {
    id: 'sug-longday',
    coupleId: COUPLE_ID,
    sourceMessageId: 'seed-msg-1',
    quoteBody: '오늘 회의 진짜 길었어 ㅠㅠ',
    quoteSenderId: SEOYEON,
    conversationAt: daysAgoIso(1),
    reason: '긴 하루를 서로 나누며 시작된 대화예요.',
    images: [{ variant: 'coffee', alt: '따뜻한 커피 두 잔을 나란히 그린 예시 이미지' }],
  },
];
