import type { TestAccount, TrialUser } from '../types';

/** 신규 체험 사용자가 프로필에서 고를 수 있는 아바타(실제 사진 업로드는 범위 밖, 0005). */
export const TRIAL_AVATARS = ['🦊', '🐰', '🐻', '🐱', '🐨', '🐧', '🦉', '🐢'] as const;
export const DEFAULT_TRIAL_AVATAR = TRIAL_AVATARS[0];

const TRIAL_USER_PREFIX = 'trial-user-';
const TRIAL_COUPLE_PREFIX = 'trial-couple-';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function newTrialUserId(): string {
  return `${TRIAL_USER_PREFIX}${randomSuffix()}`;
}

export function newTrialCoupleId(): string {
  return `${TRIAL_COUPLE_PREFIX}${randomSuffix()}`;
}

/**
 * 체험 사용자를 `/app` 화면들이 기대하는 `TestAccount` 모양으로 변환한다.
 * 닉네임이 아직 없으면 '나'로 대신 보여준다(프로필 미완료 상태에서 `/app`에 들어올 일은 없지만 방어).
 */
export function trialUserToTestAccount(user: TrialUser): TestAccount {
  return {
    id: user.id,
    nickname: user.nickname || '나',
    coupleId: user.coupleId ?? '',
    avatarEmoji: user.avatarEmoji,
  };
}
