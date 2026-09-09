import type { PatternObservation, PatternOpinion } from '../types';

/**
 * 소통 패턴 관찰의 순수 규칙(docs/decisions/0004). 실제 packages/domain으로 옮겨질 때까지 여기서 관리한다.
 * 세 가지(분석 동의 / 의견 / 코칭 활용 중단)는 서로를 유발하지 않는다 — 여기서도 섞지 않는다.
 */

/** 한 명이라도 코칭 활용 중단을 요청했으면 그 관찰은 양측 코칭에서 제외된다. */
export function isExcludedFromCoaching(observation: PatternObservation): boolean {
  return observation.coachingOptOuts.length > 0;
}

/** 이 사용자가 직접 코칭 활용 중단을 요청한 상태인가. */
export function hasOptedOut(observation: PatternObservation, userId: string): boolean {
  return observation.coachingOptOuts.some((optOut) => optOut.userId === userId);
}

/**
 * 이 사용자가 코칭 활용 중단을 해제할 수 있는가.
 * 각자 "자신의" 중단 선택만 철회할 수 있다 — 상대의 선택은 건드릴 수 없다.
 */
export function canRevokeOptOut(observation: PatternObservation, userId: string): boolean {
  return hasOptedOut(observation, userId);
}

/** 이 사용자가 남긴 의견(있다면). 본인 의견만 수정·삭제할 수 있다. */
export function ownOpinion(
  observation: PatternObservation,
  userId: string,
): PatternOpinion | undefined {
  return observation.opinions.find((opinion) => opinion.authorId === userId);
}

/**
 * 의견 현황을 중립적으로만 요약한다. 두 사람이 남겼어도 "맞다/다르다"를 판정하지 않는다.
 */
export function opinionSummary(observation: PatternObservation): 'none' | 'one' | 'both' {
  const authors = new Set(observation.opinions.map((opinion) => opinion.authorId));
  if (authors.size >= 2) return 'both';
  if (authors.size === 1) return 'one';
  return 'none';
}

/**
 * 관찰의 상태 라벨. '코칭에서 제외됨'이 의견 라벨보다 우선한다(0004 §4 — 문구만 '제외됨'으로 통일).
 * 의견 유무와 관계없이 관찰은 항상 "미확인 가설"이다.
 */
export function observationStatusLabel(observation: PatternObservation): string {
  if (isExcludedFromCoaching(observation)) return '코칭에서 제외됨';
  return '미확인 가설';
}
