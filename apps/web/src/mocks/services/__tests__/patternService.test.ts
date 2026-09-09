import { afterEach, describe, expect, it } from 'vitest';
import { createMockPatternService } from '../patternService';
import { isExcludedFromCoaching } from '../../domain/patterns';
import { COUPLE_ID, TEST_ACCOUNTS } from '../../fixtures/accounts';
import { resetAllMockData } from '../../storage';

const MINJUN = TEST_ACCOUNTS[0].id;
const SEOYEON = TEST_ACCOUNTS[1].id;

const service = createMockPatternService();

function observation(id: string) {
  const found = service.listObservations(COUPLE_ID).find((o) => o.id === id);
  if (!found) throw new Error(`관찰 없음: ${id}`);
  return found;
}

afterEach(() => {
  resetAllMockData();
});

describe('patternService — 의견', () => {
  it('본인 이름으로 의견이 관찰 아래에 쌓인다', () => {
    service.addOpinion({
      coupleId: COUPLE_ID,
      observationId: 'pat-1',
      authorId: MINJUN,
      text: '내 생각은 이래',
    });
    const opinions = observation('pat-1').opinions;
    expect(opinions).toHaveLength(1);
    expect(opinions[0]?.authorId).toBe(MINJUN);
    expect(opinions[0]?.text).toBe('내 생각은 이래');
  });

  it('남의 의견은 수정할 수 없다', () => {
    // pat-2의 op-1은 민준이 쓴 의견이다.
    expect(() =>
      service.editOpinion({
        coupleId: COUPLE_ID,
        observationId: 'pat-2',
        opinionId: 'op-1',
        authorId: SEOYEON,
        text: '서연이 몰래 고침',
      }),
    ).toThrow(/본인이 작성한 의견/);
  });

  it('남의 의견은 삭제할 수 없다', () => {
    expect(() =>
      service.removeOpinion({
        coupleId: COUPLE_ID,
        observationId: 'pat-2',
        opinionId: 'op-1',
        authorId: SEOYEON,
      }),
    ).toThrow(/본인이 작성한 의견/);
  });

  it('본인 의견은 수정·삭제할 수 있다', () => {
    service.editOpinion({
      coupleId: COUPLE_ID,
      observationId: 'pat-2',
      opinionId: 'op-1',
      authorId: MINJUN,
      text: '고친 내용',
    });
    expect(observation('pat-2').opinions[0]?.text).toBe('고친 내용');

    service.removeOpinion({
      coupleId: COUPLE_ID,
      observationId: 'pat-2',
      opinionId: 'op-1',
      authorId: MINJUN,
    });
    expect(observation('pat-2').opinions).toHaveLength(0);
  });

  it('두 사람이 의견을 남겨도 관찰 데이터는 나란히 보관될 뿐이다', () => {
    service.addOpinion({
      coupleId: COUPLE_ID,
      observationId: 'pat-1',
      authorId: MINJUN,
      text: '민준 의견',
    });
    service.addOpinion({
      coupleId: COUPLE_ID,
      observationId: 'pat-1',
      authorId: SEOYEON,
      text: '서연 의견',
    });
    const authors = observation('pat-1').opinions.map((o) => o.authorId);
    expect(authors).toEqual([MINJUN, SEOYEON]);
  });
});

describe('patternService — 코칭 활용 중단과 해제', () => {
  it('민준이 제외하면 서연은 해제할 수 없고, 민준이 해제해야 복구된다', () => {
    service.optOutOfCoaching({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: MINJUN });
    expect(isExcludedFromCoaching(observation('pat-1'))).toBe(true);

    // 서연이 "자신의" 해제를 호출해도 민준의 중단은 그대로다 — 상대 것은 건드리지 못한다.
    service.revokeOwnOptOut({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: SEOYEON });
    expect(isExcludedFromCoaching(observation('pat-1'))).toBe(true);

    // 민준이 자신의 중단을 해제하면 복구된다.
    service.revokeOwnOptOut({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: MINJUN });
    expect(isExcludedFromCoaching(observation('pat-1'))).toBe(false);
  });

  it('두 사람 모두 제외한 경우 한 사람만 해제해도 계속 제외된다', () => {
    service.optOutOfCoaching({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: MINJUN });
    service.optOutOfCoaching({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: SEOYEON });
    expect(isExcludedFromCoaching(observation('pat-1'))).toBe(true);

    service.revokeOwnOptOut({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: MINJUN });
    // 서연의 중단이 남아 있으므로 여전히 제외.
    expect(isExcludedFromCoaching(observation('pat-1'))).toBe(true);
    expect(observation('pat-1').coachingOptOuts.map((o) => o.userId)).toEqual([SEOYEON]);

    service.revokeOwnOptOut({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: SEOYEON });
    expect(isExcludedFromCoaching(observation('pat-1'))).toBe(false);
  });

  it('상대가 이미 제외한 관찰에도 내 제외를 추가할 수 있고, 내 것만 해제된다', () => {
    // pat-4는 서연이 이미 제외한 상태.
    expect(isExcludedFromCoaching(observation('pat-4'))).toBe(true);

    service.optOutOfCoaching({ coupleId: COUPLE_ID, observationId: 'pat-4', userId: MINJUN });
    service.revokeOwnOptOut({ coupleId: COUPLE_ID, observationId: 'pat-4', userId: MINJUN });
    // 서연의 중단은 그대로.
    expect(observation('pat-4').coachingOptOuts.map((o) => o.userId)).toEqual([SEOYEON]);
    expect(isExcludedFromCoaching(observation('pat-4'))).toBe(true);
  });

  it('같은 사용자가 중복으로 제외를 눌러도 한 건만 쌓인다', () => {
    service.optOutOfCoaching({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: MINJUN });
    service.optOutOfCoaching({ coupleId: COUPLE_ID, observationId: 'pat-1', userId: MINJUN });
    expect(observation('pat-1').coachingOptOuts).toHaveLength(1);
  });
});
