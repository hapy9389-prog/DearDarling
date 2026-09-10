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
  /**
   * 접힌 코칭 카드에 보여줄 짧은 요점 한 문장(선택). 긴 insight를 두 줄로 자르는 대신,
   * 좁은 화면에서도 완결되는 문장을 쓴다. 없으면 화면이 insight를 최대 2줄로 방어한다.
   */
  headline?: string;
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

/**
 * 화면 검토용 예시 이미지(실제 업로드 사진이 아니다). 항상 '예시 이미지' 라벨과 함께 렌더한다 —
 * 실제 사진 업로드·사진 내용 AI 분석·AI 이미지 생성은 후속 기능(docs/decisions/0008).
 */
export interface ExampleImageRef {
  /** ExampleImage 컴포넌트가 그릴 결정적 일러스트 종류. 파일 경로가 아니다. */
  variant: 'walk' | 'coffee' | 'night-talk' | 'sea' | 'home' | 'trip';
  /** 스크린리더·캡션용 설명. */
  alt: string;
}

/**
 * 추억 — 대화에서 직접 골라 저장했거나, AI 발견 제안에서 '간직하기'로 저장한 커플 공유 항목
 * (docs/decisions/0008). 저장 시점 스냅샷을 담아 원본 메시지가 없어져도 그대로 보인다.
 */
export interface Memory {
  id: string;
  coupleId: CoupleId;
  /** 저장한 사람. 계정 전환과 무관하게 고정 — 메모 수정·삭제 권한 판단 기준. */
  savedByUserId: UserId;
  /** 저장 시각(ISO). 목록 정렬·'저장한 날짜' 구분선 기준. 메모를 수정해도 바뀌지 않는다. */
  savedAt: string;
  note?: string;
  /** 메모를 마지막으로 고친 시각(있을 때만). */
  noteUpdatedAt?: string;
  /** 원본 메시지 id — 중복 저장 방지와 대화 화면 '추억에 저장됨' 표시에만 쓴다. */
  sourceMessageId: MessageId;
  /** AI 발견 제안에서 간직한 추억이면 true. */
  fromSuggestion?: boolean;
  /** 카드 레이아웃 힌트. 없으면 images 유무로 파생한다. */
  layout?: 'photo' | 'conversation';
  /** 관련 예시 이미지(선택). 직접 저장 흐름에서는 항상 비어 있다. */
  images?: ExampleImageRef[];
  // ── 저장 시점 스냅샷 ──
  quoteBody: string;
  quoteSenderId: UserId;
  /** 원본 메시지의 createdAt — 카드에 '대화 날짜'로 보여준다. */
  conversationAt: string;
}

/** AI가 발견한 순간(화면 검토용 시드 예시 — 실제 분석 결과가 아니다, docs/decisions/0008). */
export interface MemorySuggestion {
  id: string;
  coupleId: CoupleId;
  sourceMessageId: MessageId;
  quoteBody: string;
  quoteSenderId: UserId;
  conversationAt: string;
  /** 왜 이 순간을 골랐는지 — 사람이 읽는 한 줄. 관찰형으로만, 상대 감정을 단정하지 않는다. */
  reason: string;
  /** 관련 예시 이미지(선택). 사진 내용 분석이 아니라 그 순간에 어울리는 예시 일러스트. */
  images?: ExampleImageRef[];
}

/**
 * '그때의 우리' 리마인드 후보 1건. 앨범에 저장된 추억에서만 파생한다(삭제된 추억을 되살리지 않음).
 * 정확히 마일스톤 날짜면 'exact'("100일 전 오늘"), 근사면 'approx'("약 100일 전").
 */
export interface RememberWhen {
  memory: Memory;
  match: 'exact' | 'approx';
  /** 예: '100일 전 오늘' / '약 1년 전'. */
  phrase: string;
  /** 이 리마인드만 닫기 위한 키(memoryId + 마일스톤). 같은 추억의 다른 마일스톤은 계속 뜬다. */
  dismissKey: string;
}
