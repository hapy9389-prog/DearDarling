import type { CoupleProfile } from '../types';
import { COUPLE_ID } from './accounts';

/** 화면 검토용 커플 프로필. 시작일은 고정이라 오늘 날짜에 따라 "함께한 지 N일"이 자연스럽게 늘어난다. */
export const SEED_COUPLE_PROFILE: CoupleProfile = {
  coupleId: COUPLE_ID,
  connectedAt: '2023-05-20T09:00:00.000Z',
  relationshipStartDate: '2023-05-20',
};
