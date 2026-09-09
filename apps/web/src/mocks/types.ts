// 화면 검토 단계의 가상 데이터 타입. 실제 packages/contracts로 옮겨질 때까지 여기서 관리한다.

export type UserId = string;
export type CoupleId = string;
export type MessageId = string;

export interface TestAccount {
  id: UserId;
  nickname: string;
  coupleId: CoupleId;
  avatarEmoji: string;
}

export interface CoupleProfile {
  coupleId: CoupleId;
  /** 사귀기 시작한 날('YYYY-MM-DD'). 홈의 "함께한 날짜(D+N)" 계산 기준. 만난 첫날이 1일. */
  relationshipStartDate: string;
}

export type MessageStatus = 'sending' | 'saved' | 'failed';

export interface ChatMessage {
  id: MessageId;
  coupleId: CoupleId;
  senderId: UserId;
  body: string;
  createdAt: string;
  status: MessageStatus;
}

/** AI가 근거로 삼은 대화를 화면에는 내부 메시지 ID가 아니라 사람이 읽을 수 있는 문장으로 보여준다. */
export interface CoachingSuggestion {
  id: string;
  coupleId: CoupleId;
  recipientId: UserId;
  insight: string;
  evidenceText: string;
  evidenceMessageIds: MessageId[];
  alternatives: string[];
  createdAt: string;
  /**
   * 이 제안이 어느 주간 패턴 관찰에서 비롯됐는지(있다면). 그 관찰이 코칭 활용 중단 상태이면
   * 이 제안은 양측 대화 코칭에서 빠진다(docs/decisions/0004 §5).
   */
  sourcePatternId?: string;
}

/**
 * 주간 리포트에서 관찰된 소통 패턴. 두 사람이 의견을 남겨도 확정된 사실로 바뀌지 않는다
 * (docs/decisions/0004, 0007). 상대의 성향·감정을 단정하는 문구를 쓰지 않는다.
 *
 * title·interpretation·evidenceQuotes는 이번 주 대표 발견을 풍부하게 보여주기 위한 선택 필드다
 * (0007). 예전에 저장된 관찰에는 없을 수 있으므로 화면에서 항상 기본값으로 방어한다.
 */
export interface PatternObservation {
  id: string;
  coupleId: CoupleId;
  /** 이 관찰이 속한 주의 월요일('YYYY-MM-DD'). */
  weekOf: string;
  /** 관찰한 모습 한 줄. 확정된 사실처럼 들리지 않게 관찰형으로만 쓴다. */
  observation: string;
  /** 근거가 된 대화를 사람이 읽을 수 있게 인용한 문장(단수). evidenceQuotes가 없을 때의 대체값. */
  evidenceText: string;
  evidenceMessageIds: MessageId[];
  /** 도움이 될 제안(코칭 파생물). 코칭 활용 중단 시 화면에서 가린다. */
  suggestion: string;
  /** 발견의 자연스러운 제목(대표 발견용, 선택). 없으면 화면이 일반 제목으로 대체한다. */
  title?: string;
  /**
   * AI 해석 문단(대표 발견용, 선택, 최대 2문단). 관찰 사실(observation)과 분리해 "이렇게 이해해
   * 볼 수도 있어요"로 보여준다. 실천 조언은 여기 넣지 않는다(코칭 제외 우회 금지, 0007).
   */
  interpretation?: string[];
  /** 근거 인용을 여러 장면으로(대표 발견용, 선택). 없으면 [evidenceText]를 쓴다. */
  evidenceQuotes?: string[];
  /**
   * 발견의 흐름을 설명하는 작은 도식의 단계 라벨(대표 발견용, 선택, 보통 3개).
   * 라벨만 담는다 — 문장으로 다시 설명하지 않는다. 없으면 도식을 생략한다.
   */
  flow?: string[];
  /** AI 관찰을 덮어쓰지 않고 아래에 쌓이는, 각자가 남긴 의견. */
  opinions: PatternOpinion[];
  /** 코칭 활용 중단을 요청한 사람들. 한 명이라도 있으면 양측 코칭에서 제외된다. */
  coachingOptOuts: PatternCoachingOptOut[];
}

export interface PatternOpinion {
  id: string;
  authorId: UserId;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatternCoachingOptOut {
  userId: UserId;
  createdAt: string;
}

/** 주간 리포트 상단의 핵심 통계(0007에서 상단으로 이동). 관계 점수·순위는 넣지 않는다. */
export interface WeeklyReportStats {
  totalMessages: number;
  /** 이번 주 대화가 오간 날 수. */
  daysWithConversation: number;
  /** 기준 일수(보통 7). "대화한 날 N일" 표시에 함께 쓴다. */
  activeDaysTotal: number;
  /** 월~일 순서. "대화가 많았던 요일"은 이 배열의 최댓값에서 파생한다. */
  byWeekday: { weekday: string; count: number }[];
  /** 통계로 뒷받침되는 범위의 한두 줄. 시간대 등 근거 없는 단정은 쓰지 않는다. */
  highlights: string[];
}

export interface WeeklyReport {
  coupleId: CoupleId;
  weekOf: string;
  /** 리포트가 도착한 시각(매주 월요일). */
  deliveredAt: string;
  stats: WeeklyReportStats;
  /**
   * 이번 주 대표 발견으로 삼을 관찰 id. 실제 분석에서 눈에 띄는 관찰이 없으면 null로 두고
   * 억지로 만들지 않는다(0007) — 이때도 통계는 보인다.
   */
  headlineObservationId: string | null;
}

/** '우리' 탭의 개인 상담(개인 채널). 상대·공유 리포트에 자동 공개되지 않는다. */
export interface ConsultationPrompt {
  id: string;
  question: string;
  /** 화면 검토용 시드 답변 — 실제 AI 답변이 아니다. */
  answer: string;
}

export type ChatConnectionState = 'connected' | 'reconnecting' | 'disconnected';

/**
 * 코칭 숨기기(coachingVisible)와 분석 철회(analysisConsent)는 서로 다른 동작이다.
 * - coachingVisible: 본인 화면에서 코칭 카드를 보여줄지 여부(표시 설정). 꺼도 분석 자체는 계속될 수 있다.
 * - analysisConsent: 이 사용자가 커플 분석에 동의했는지 여부. 두 사람 모두 true여야 커플 분석이 활성화된다.
 */
export interface UserSettings {
  userId: UserId;
  analysisConsent: boolean;
  coachingVisible: boolean;
  draftHelpEnabled: boolean;
}

export type ChatDevScenario =
  'happy-path' | 'empty' | 'ai-warming-up' | 'ai-failure' | 'disconnected';
