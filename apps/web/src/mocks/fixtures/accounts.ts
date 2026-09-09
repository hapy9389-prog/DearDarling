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
