import type { ChatMessage } from '../types';
import { COUPLE_ID, TEST_ACCOUNTS } from './accounts';

const MINJUN = TEST_ACCOUNTS[0].id;
const SEOYEON = TEST_ACCOUNTS[1].id;

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

export const EVIDENCE_MESSAGE_ID = 'seed-msg-4';

/** 코칭 카드의 근거 문장이 실제로 이 대화에서 나온 말이 되도록, 근거로 쓰는 메시지를 고정 id로 둔다. */
export const SEED_MESSAGES: ChatMessage[] = [
  {
    id: 'seed-msg-1',
    coupleId: COUPLE_ID,
    senderId: SEOYEON,
    body: '오늘 회의 진짜 길었어 ㅠㅠ',
    createdAt: iso(42),
    status: 'saved',
  },
  {
    id: 'seed-msg-2',
    coupleId: COUPLE_ID,
    senderId: MINJUN,
    body: '고생했다 저녁은 먹었어?',
    createdAt: iso(40),
    status: 'saved',
  },
  {
    id: 'seed-msg-3',
    coupleId: COUPLE_ID,
    senderId: SEOYEON,
    body: '아니 아직... 입맛도 없고',
    createdAt: iso(38),
    status: 'saved',
  },
  {
    id: EVIDENCE_MESSAGE_ID,
    coupleId: COUPLE_ID,
    senderId: SEOYEON,
    body: '요즘 좀 힘들었어. 별일 아닌데 그냥 그래',
    createdAt: iso(36),
    status: 'saved',
  },
  {
    id: 'seed-msg-5',
    coupleId: COUPLE_ID,
    senderId: MINJUN,
    body: '그렇구나. 오늘은 일단 좀 쉬자',
    createdAt: iso(33),
    status: 'saved',
  },
  {
    id: 'seed-msg-6',
    coupleId: COUPLE_ID,
    senderId: SEOYEON,
    body: 'ㅇㅇ 고마워 🥲',
    createdAt: iso(30),
    status: 'saved',
  },
];
