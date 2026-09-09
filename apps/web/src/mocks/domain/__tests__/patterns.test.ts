import { describe, expect, it } from 'vitest';
import {
  canRevokeOptOut,
  hasOptedOut,
  isExcludedFromCoaching,
  observationStatusLabel,
  opinionSummary,
  ownOpinion,
} from '../patterns';
import type { PatternObservation } from '../../types';

function makeObservation(overrides: Partial<PatternObservation> = {}): PatternObservation {
  return {
    id: 'pat-x',
    coupleId: 'couple-1',
    weekOf: '2026-09-07',
    observation: '무언가가 관찰됐어요 (아직 확인되지 않음)',
    evidenceText: '어떤 대화',
    evidenceMessageIds: [],
    suggestion: '이렇게 해볼 수 있어요',
    opinions: [],
    coachingOptOuts: [],
    ...overrides,
  };
}

describe('isExcludedFromCoaching — 한 명이라도 중단하면 제외', () => {
  it('중단 요청이 없으면 제외가 아니다', () => {
    expect(isExcludedFromCoaching(makeObservation())).toBe(false);
  });

  it('한 명이 중단을 요청하면 제외된다', () => {
    const observation = makeObservation({
      coachingOptOuts: [{ userId: 'user-minjun', createdAt: 'x' }],
    });
    expect(isExcludedFromCoaching(observation)).toBe(true);
  });
});

describe('canRevokeOptOut — 각자 자신의 중단만 해제', () => {
  const bothOut = makeObservation({
    coachingOptOuts: [
      { userId: 'user-minjun', createdAt: 'x' },
      { userId: 'user-seoyeon', createdAt: 'x' },
    ],
  });

  it('본인이 중단을 요청한 경우에만 해제할 수 있다', () => {
    const minjunOut = makeObservation({
      coachingOptOuts: [{ userId: 'user-minjun', createdAt: 'x' }],
    });
    expect(canRevokeOptOut(minjunOut, 'user-minjun')).toBe(true);
    // 서연은 민준의 중단을 해제할 수 없다.
    expect(canRevokeOptOut(minjunOut, 'user-seoyeon')).toBe(false);
  });

  it('두 사람 모두 중단했으면 각자 자신의 것만 해제 대상이다', () => {
    expect(canRevokeOptOut(bothOut, 'user-minjun')).toBe(true);
    expect(canRevokeOptOut(bothOut, 'user-seoyeon')).toBe(true);
  });

  it('hasOptedOut은 그 사용자의 중단 여부만 본다', () => {
    expect(hasOptedOut(bothOut, 'user-minjun')).toBe(true);
    expect(hasOptedOut(makeObservation(), 'user-minjun')).toBe(false);
  });
});

describe('opinionSummary — 중립 요약 (갈렸다 판정 없음)', () => {
  it('의견이 없으면 none', () => {
    expect(opinionSummary(makeObservation())).toBe('none');
  });

  it('한 사람만 남기면 one', () => {
    const observation = makeObservation({
      opinions: [{ id: 'o1', authorId: 'user-minjun', text: 'a', createdAt: 'x', updatedAt: 'x' }],
    });
    expect(opinionSummary(observation)).toBe('one');
  });

  it('두 사람이 남기면 both', () => {
    const observation = makeObservation({
      opinions: [
        { id: 'o1', authorId: 'user-minjun', text: 'a', createdAt: 'x', updatedAt: 'x' },
        { id: 'o2', authorId: 'user-seoyeon', text: 'b', createdAt: 'x', updatedAt: 'x' },
      ],
    });
    expect(opinionSummary(observation)).toBe('both');
  });

  it('ownOpinion은 본인이 쓴 의견만 돌려준다', () => {
    const observation = makeObservation({
      opinions: [{ id: 'o1', authorId: 'user-minjun', text: 'a', createdAt: 'x', updatedAt: 'x' }],
    });
    expect(ownOpinion(observation, 'user-minjun')?.id).toBe('o1');
    expect(ownOpinion(observation, 'user-seoyeon')).toBeUndefined();
  });
});

describe('observationStatusLabel — 코칭에서 제외됨이 우선', () => {
  it('기본은 미확인 가설', () => {
    expect(observationStatusLabel(makeObservation())).toBe('미확인 가설');
  });

  it('의견을 두 사람이 남겨도 여전히 미확인 가설', () => {
    const observation = makeObservation({
      opinions: [
        { id: 'o1', authorId: 'user-minjun', text: 'a', createdAt: 'x', updatedAt: 'x' },
        { id: 'o2', authorId: 'user-seoyeon', text: 'b', createdAt: 'x', updatedAt: 'x' },
      ],
    });
    expect(observationStatusLabel(observation)).toBe('미확인 가설');
  });

  it('코칭에서 제외되면 그 라벨이 우선한다', () => {
    const observation = makeObservation({
      opinions: [{ id: 'o1', authorId: 'user-minjun', text: 'a', createdAt: 'x', updatedAt: 'x' }],
      coachingOptOuts: [{ userId: 'user-seoyeon', createdAt: 'x' }],
    });
    expect(observationStatusLabel(observation)).toBe('코칭에서 제외됨');
  });
});
