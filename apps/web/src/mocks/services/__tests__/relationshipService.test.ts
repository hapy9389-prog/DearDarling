import { afterEach, describe, expect, it } from 'vitest';
import { createMockRelationshipService } from '../relationshipService';
import { COUPLE_ID } from '../../fixtures/accounts';
import { resetAllMockData } from '../../storage';

const TRIAL_COUPLE = 'trial-couple-xyz';

afterEach(() => {
  resetAllMockData();
});

describe('relationshipService — 검토 커플', () => {
  it('고정 시드 프로필을 돌려준다', () => {
    const service = createMockRelationshipService();
    const profile = service.getCoupleProfile(COUPLE_ID);
    expect(profile.relationshipStartDate).toBe('2023-05-20');
    expect(profile.connectedAt).toBeTruthy();
  });

  it('오늘 요약(가상 예시)을 돌려준다', () => {
    expect(createMockRelationshipService().getTodaySummary(COUPLE_ID)).not.toBeNull();
  });
});

describe('relationshipService — 신규 체험 커플', () => {
  it('저장된 프로필이 없어도 오류 없이 기본값(시작일 null)을 돌려준다', () => {
    const service = createMockRelationshipService();
    const profile = service.getCoupleProfile(TRIAL_COUPLE);
    expect(profile.coupleId).toBe(TRIAL_COUPLE);
    expect(profile.relationshipStartDate).toBeNull();
  });

  it('연애 시작일을 나중에 설정·삭제할 수 있고 연결일과 분리된다', () => {
    const service = createMockRelationshipService();

    const set = service.updateCoupleProfile(TRIAL_COUPLE, { relationshipStartDate: '2025-01-01' });
    expect(set.relationshipStartDate).toBe('2025-01-01');
    expect(service.getCoupleProfile(TRIAL_COUPLE).relationshipStartDate).toBe('2025-01-01');

    const cleared = service.updateCoupleProfile(TRIAL_COUPLE, { relationshipStartDate: null });
    expect(cleared.relationshipStartDate).toBeNull();
    // 연결일은 시작일 변경과 무관하게 유지된다.
    expect(cleared.connectedAt).toBe(set.connectedAt);
  });

  it('체험 커플에는 오늘 요약을 제공하지 않는다(null)', () => {
    expect(createMockRelationshipService().getTodaySummary(TRIAL_COUPLE)).toBeNull();
  });
});
