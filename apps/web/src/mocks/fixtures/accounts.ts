import type { TestAccount } from '../types';

export const COUPLE_ID = 'couple-1';

// 정확히 두 계정으로 이뤄진 튜플로 고정해 둔다 — noUncheckedIndexedAccess 아래에서도
// TEST_ACCOUNTS[0]/[1] 인덱스 접근이 undefined 없이 안전하게 추론되도록 하기 위함.
export const TEST_ACCOUNTS: readonly [TestAccount, TestAccount] = [
  { id: 'user-minjun', nickname: '민준', coupleId: COUPLE_ID, avatarEmoji: '🐻' },
  { id: 'user-seoyeon', nickname: '서연', coupleId: COUPLE_ID, avatarEmoji: '🐱' },
];

export const DEFAULT_ACCOUNT_ID = TEST_ACCOUNTS[0].id;

export function getAccount(userId: string): TestAccount {
  const account = TEST_ACCOUNTS.find((a) => a.id === userId);
  if (!account) throw new Error(`알 수 없는 테스트 계정입니다: ${userId}`);
  return account;
}

export function getPartner(userId: string): TestAccount {
  const partner = TEST_ACCOUNTS.find((a) => a.id !== userId);
  if (!partner) throw new Error('상대 테스트 계정을 찾을 수 없습니다.');
  return partner;
}

/**
 * 검토 모드(민준·서연 예시)와 신규 체험을 구분하는 기준(0010).
 * 시드 대화·코칭·리포트·추억은 검토 커플에만 돌려주고, 체험 커플은 빈 상태로 시작한다.
 * 실제 백엔드로 교체할 때 이 두 함수와 호출부를 함께 제거한다.
 */
export function isReviewCouple(coupleId: string): boolean {
  return coupleId === COUPLE_ID;
}

export function isReviewUser(userId: string): boolean {
  return TEST_ACCOUNTS.some((a) => a.id === userId);
}
