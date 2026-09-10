import { describe, expect, it } from 'vitest';
import { isNearBottom, NEAR_BOTTOM_PX, shouldFollowToBottom } from '../scrollBehavior';

describe('isNearBottom', () => {
  it('하단에 있거나 임계값 이내면 true', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 940, clientHeight: 60 })).toBe(true); // 0px
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 60 })).toBe(true); // 40px
  });

  it('임계값보다 위로 올라가 있으면 false', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 60 })).toBe(false);
  });

  it(`경계(${NEAR_BOTTOM_PX}px)에서 뒤집힌다`, () => {
    const atThreshold = 1000 - 60 - NEAR_BOTTOM_PX;
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: atThreshold, clientHeight: 60 })).toBe(
      true,
    );
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: atThreshold - 1, clientHeight: 60 })).toBe(
      false,
    );
  });
});

describe('shouldFollowToBottom', () => {
  const received = {
    grew: true,
    lastMessageId: 'm2',
    prevLastMessageId: 'm1',
    lastFromMe: false,
    wasNearBottom: false,
  };

  it('개수도 마지막 메시지도 그대로면(전송 중 → 저장 완료 등) 스크롤하지 않는다', () => {
    expect(
      shouldFollowToBottom({
        ...received,
        grew: false,
        lastMessageId: 'm1',
        prevLastMessageId: 'm1',
      }),
    ).toBe(false);
  });

  it('내가 보낸 메시지가 마지막이면 하단을 안 보고 있었어도 최신으로 이동', () => {
    expect(shouldFollowToBottom({ ...received, lastFromMe: true, wasNearBottom: false })).toBe(
      true,
    );
  });

  it('수신인데 직전에 하단을 보고 있었으면 따라간다', () => {
    expect(shouldFollowToBottom({ ...received, lastFromMe: false, wasNearBottom: true })).toBe(
      true,
    );
  });

  it('수신인데 과거 대화를 읽는 중(하단 아님)이면 가만히 둔다', () => {
    expect(shouldFollowToBottom({ ...received, lastFromMe: false, wasNearBottom: false })).toBe(
      false,
    );
  });

  it('개수는 그대로여도 마지막 메시지가 내 것으로 바뀌면 이동(재조정 교체)', () => {
    expect(
      shouldFollowToBottom({
        grew: false,
        lastMessageId: 'm2',
        prevLastMessageId: 'm1',
        lastFromMe: true,
        wasNearBottom: false,
      }),
    ).toBe(true);
  });
});
