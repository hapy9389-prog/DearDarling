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
 * 주간 리포트에서 관찰된 소통 패턴. 항상 "미확인 가설"로 다룬다 — 두 사람이 의견을 남겨도
 * 확정되지 않는다(docs/decisions/0004). 상대의 성향·감정을 단정하는 문구를 쓰지 않는다.
 */
export interface PatternObservation {
  id: string;
  coupleId: CoupleId;
  /** 이 관찰이 속한 주의 월요일('YYYY-MM-DD'). */
  weekOf: string;
  /** 관찰 한 줄. 잠정 표현("~한 경향이 관찰됐어요 (아직 확인되지 않음)"). */
  observation: string;
  /** 근거가 된 대화를 사람이 읽을 수 있게 인용한 문장. */
  evidenceText: string;
  evidenceMessageIds: MessageId[];
  /** 도움이 될 제안(코칭 파생물). 코칭 활용 중단 시 화면에서 가린다. */
  suggestion: string;
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

/** 주간 리포트의 보조 통계(관찰이 주 콘텐츠, 통계는 보조). */
export interface WeeklyReportStats {
  totalMessages: number;
  /** 월~일 순서. */
  byWeekday: { weekday: string; count: number }[];
  highlights: string[];
}

export interface WeeklyReport {
  coupleId: CoupleId;
  weekOf: string;
  /** 리포트가 도착한 시각(매주 월요일). */
  deliveredAt: string;
  stats: WeeklyReportStats;
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
