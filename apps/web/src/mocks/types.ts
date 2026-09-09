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
