import type { ChatMessage, PatternObservation, WeeklyReport } from '../types';
import { SEED_PATTERN_OBSERVATIONS, SEED_WEEKLY_REPORT } from '../fixtures/patterns';
import { ownOpinion } from '../domain/patterns';
import { buildTrialWeeklyReport } from '../domain/weeklyReport';
import { isReviewCouple } from '../fixtures/accounts';
import { coupleKey, readJSON, writeJSON } from '../storage';

/**
 * 주간 패턴 관찰과 그에 대한 의견·코칭 활용 중단을 다루는 커플 단위 서비스(docs/decisions/0004).
 * 관찰·의견·중단 선택은 두 사람이 함께 보는 데이터라 coupleKey에 저장한다.
 * 분석 동의(개인·userKey)와는 저장 위치도 규칙도 분리돼 있다.
 * 실제 API가 생기면 이 인터페이스의 구현체만 HTTP 호출로 교체하면 된다.
 */
export interface OpinionDraftInput {
  coupleId: string;
  observationId: string;
  authorId: string;
  text: string;
}
export interface OpinionEditInput extends OpinionDraftInput {
  opinionId: string;
}
export interface OpinionRemoveInput {
  coupleId: string;
  observationId: string;
  opinionId: string;
  authorId: string;
}
export interface CoachingOptOutInput {
  coupleId: string;
  observationId: string;
  userId: string;
}

export interface PatternService {
  listObservations(coupleId: string): PatternObservation[];
  getWeeklyReport(coupleId: string): WeeklyReport;
  /** 본인 이름으로 의견을 추가한다(AI 관찰을 덮어쓰지 않고 아래에 쌓인다). */
  addOpinion(input: OpinionDraftInput): PatternObservation[];
  /** 본인이 작성한 의견만 수정할 수 있다. */
  editOpinion(input: OpinionEditInput): PatternObservation[];
  /** 본인이 작성한 의견만 삭제할 수 있다. */
  removeOpinion(input: OpinionRemoveInput): PatternObservation[];
  /** 이 관찰을 코칭에 사용하지 않도록 요청한다(한 명이라도 하면 양측 코칭에서 제외). */
  optOutOfCoaching(input: CoachingOptOutInput): PatternObservation[];
  /** 본인의 코칭 활용 중단 선택만 해제할 수 있다 — 상대의 선택은 건드릴 수 없다. */
  revokeOwnOptOut(input: CoachingOptOutInput): PatternObservation[];
}

function storageKey(coupleId: string): string {
  return coupleKey(coupleId, 'patternObservations');
}

/** 저장소를 읽어 시드가 아닌 독립된 사본을 돌려준다(시드 상수를 실수로 변형하지 않도록). */
function load(coupleId: string): PatternObservation[] {
  // 시드 관찰은 검토 커플에게만. 신규 체험 커플엔 관찰이 없다(0010).
  const fallback = isReviewCouple(coupleId) ? SEED_PATTERN_OBSERVATIONS : [];
  const raw = readJSON<PatternObservation[]>(storageKey(coupleId), fallback);
  return raw.map((observation) => ({
    ...observation,
    opinions: observation.opinions.map((opinion) => ({ ...opinion })),
    coachingOptOuts: observation.coachingOptOuts.map((optOut) => ({ ...optOut })),
  }));
}

function save(coupleId: string, observations: PatternObservation[]): PatternObservation[] {
  writeJSON(storageKey(coupleId), observations);
  return observations;
}

function mapObservation(
  observations: PatternObservation[],
  observationId: string,
  update: (observation: PatternObservation) => PatternObservation,
): PatternObservation[] {
  let found = false;
  const next = observations.map((observation) => {
    if (observation.id !== observationId) return observation;
    found = true;
    return update(observation);
  });
  if (!found) throw new Error(`관찰을 찾을 수 없어요: ${observationId}`);
  return next;
}

export function createMockPatternService(): PatternService {
  return {
    listObservations(coupleId) {
      return load(coupleId);
    },

    getWeeklyReport(coupleId) {
      if (isReviewCouple(coupleId)) return SEED_WEEKLY_REPORT;
      // 신규 체험 커플: AI 분석 결과 없이, 저장된 대화량으로만 통계를 만든다(0010).
      const messages = readJSON<ChatMessage[]>(coupleKey(coupleId, 'messages'), []);
      return buildTrialWeeklyReport(coupleId, messages);
    },

    addOpinion({ coupleId, observationId, authorId, text }) {
      const now = new Date().toISOString();
      const next = mapObservation(load(coupleId), observationId, (observation) => {
        if (ownOpinion(observation, authorId)) {
          throw new Error('이미 남긴 의견이 있어요. 수정하거나 삭제한 뒤 다시 남겨 주세요.');
        }
        return {
          ...observation,
          opinions: [
            ...observation.opinions,
            { id: crypto.randomUUID(), authorId, text, createdAt: now, updatedAt: now },
          ],
        };
      });
      return save(coupleId, next);
    },

    editOpinion({ coupleId, observationId, opinionId, authorId, text }) {
      const now = new Date().toISOString();
      const next = mapObservation(load(coupleId), observationId, (observation) => ({
        ...observation,
        opinions: observation.opinions.map((opinion) => {
          if (opinion.id !== opinionId) return opinion;
          if (opinion.authorId !== authorId) {
            throw new Error('본인이 작성한 의견만 수정할 수 있어요.');
          }
          return { ...opinion, text, updatedAt: now };
        }),
      }));
      return save(coupleId, next);
    },

    removeOpinion({ coupleId, observationId, opinionId, authorId }) {
      const next = mapObservation(load(coupleId), observationId, (observation) => {
        const target = observation.opinions.find((opinion) => opinion.id === opinionId);
        if (target && target.authorId !== authorId) {
          throw new Error('본인이 작성한 의견만 삭제할 수 있어요.');
        }
        return {
          ...observation,
          opinions: observation.opinions.filter((opinion) => opinion.id !== opinionId),
        };
      });
      return save(coupleId, next);
    },

    optOutOfCoaching({ coupleId, observationId, userId }) {
      const next = mapObservation(load(coupleId), observationId, (observation) => {
        if (observation.coachingOptOuts.some((optOut) => optOut.userId === userId)) {
          return observation;
        }
        return {
          ...observation,
          coachingOptOuts: [
            ...observation.coachingOptOuts,
            { userId, createdAt: new Date().toISOString() },
          ],
        };
      });
      return save(coupleId, next);
    },

    revokeOwnOptOut({ coupleId, observationId, userId }) {
      const next = mapObservation(load(coupleId), observationId, (observation) => ({
        ...observation,
        // 본인(userId) 것만 제거한다 — 상대가 남긴 중단 선택은 그대로 둔다.
        coachingOptOuts: observation.coachingOptOuts.filter((optOut) => optOut.userId !== userId),
      }));
      return save(coupleId, next);
    },
  };
}
