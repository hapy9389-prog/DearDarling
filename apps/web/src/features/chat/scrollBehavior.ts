/**
 * 대화 목록의 자동 스크롤 규칙(순수 함수). docs/decisions/0009.
 *
 * - 첫 진입: 화면이 실제로 보이고 레이아웃이 잡힌 뒤 최신 메시지로 한 번 이동(MessageList가 옵저버로 처리).
 * - 탭 재방문: 스크롤 위치를 그대로 둔다(여기서 아무 것도 하지 않음 — 목록이 안 바뀌면 호출되지 않음).
 * - 내가 전송: 최신 메시지로 이동.
 * - 새 메시지 수신: 직전에 하단 근처를 보고 있던 경우에만 따라간다(과거 대화 열람 중에는 가만히 둔다).
 * - 기존 메시지의 상태만 바뀜(전송 중 → 저장 완료 등): 스크롤하지 않는다.
 */

/** 하단에서 이 픽셀 이내면 "하단을 보고 있다"로 본다. */
export const NEAR_BOTTOM_PX = 80;

export function isNearBottom(el: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

export interface ListChange {
  /** 메시지 개수가 늘었나. */
  grew: boolean;
  lastMessageId: string | undefined;
  prevLastMessageId: string | undefined;
  /** 목록의 마지막 메시지가 내가 보낸 것인가. */
  lastFromMe: boolean;
  /** 이번 갱신 직전에 하단 근처를 보고 있었나. */
  wasNearBottom: boolean;
}

/** 목록이 바뀐 뒤 최신 메시지로 스크롤해야 하는지. */
export function shouldFollowToBottom(change: ListChange): boolean {
  const lastChanged = change.lastMessageId !== change.prevLastMessageId;
  // 개수도 그대로고 마지막 메시지도 그대로면(전송 중 → 저장 완료 같은 상태 변화) 스크롤하지 않는다.
  if (!change.grew && !lastChanged) return false;
  // 내가 방금 보낸 메시지면 항상 최신으로 이동한다.
  if (change.lastFromMe) return true;
  // 수신은 하단을 보고 있던 경우에만 따라간다.
  return change.wasNearBottom;
}
