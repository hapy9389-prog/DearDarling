import { describe, expect, it } from 'vitest';
import { evaluateInviteState, evaluateConnectability, type InviteRow } from '../../src/services/inviteService';

/**
 * `acceptInvite`/`previewInvite`가 공유하는 순수 판정 함수만 따로 검증한다 — DB 접근이 없어
 * 로컬 테스트 DB 연결 여부와 무관하게 항상 실행할 수 있다. 잠금 순서·트랜잭션 동작 자체는
 * `test/integration/invites.test.ts`(실제 DB 필요)에서 검증한다.
 */

function makeInvite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'invite-1',
    code: 'DD-ABCDEF',
    inviter_user_id: 'inviter-1',
    accepted_by_user_id: null,
    status: 'pending',
    created_at: new Date('2025-01-01T00:00:00Z'),
    expires_at: new Date('2099-01-01T00:00:00Z'),
    accepted_at: null,
    ...overrides,
  };
}

describe('evaluateInviteState', () => {
  it('returns not-found when the invite does not exist', () => {
    expect(evaluateInviteState(undefined, 'viewer-1')).toBe('not-found');
  });

  it('returns revoked/already-accepted for those statuses regardless of expiry', () => {
    expect(evaluateInviteState(makeInvite({ status: 'revoked' }), 'viewer-1')).toBe('revoked');
    expect(evaluateInviteState(makeInvite({ status: 'accepted' }), 'viewer-1')).toBe(
      'already-accepted',
    );
  });

  it('returns expired when status is already expired, or when expires_at has passed even if status is still pending', () => {
    expect(evaluateInviteState(makeInvite({ status: 'expired' }), 'viewer-1')).toBe('expired');
    // 상태 컬럼은 아직 'pending'이지만 시간이 지난 경우 — 지연 정리 전에도 시간 기준으로
    // 거절해야 한다(이 함수가 DB에 쓰지 않으므로, 상태 갱신 여부와 무관하게 항상 이렇게 판정).
    const timedOut = makeInvite({ status: 'pending', expires_at: new Date('2020-01-01T00:00:00Z') });
    expect(evaluateInviteState(timedOut, 'viewer-1', new Date('2025-06-01T00:00:00Z').getTime())).toBe(
      'expired',
    );
  });

  it('returns self when the viewer is the inviter', () => {
    expect(evaluateInviteState(makeInvite({ inviter_user_id: 'same' }), 'same')).toBe('self');
  });

  it('returns ok for a pending, unexpired invite viewed by someone other than the inviter', () => {
    expect(evaluateInviteState(makeInvite(), 'someone-else')).toBe('ok');
  });

  it('checks self before expiry-by-time is irrelevant — order matches acceptInvite: revoked > accepted > expired > self', () => {
    // 취소된 초대는 본인이 봐도 revoked로 나와야 한다(자기 초대 여부보다 먼저 판정).
    expect(evaluateInviteState(makeInvite({ status: 'revoked', inviter_user_id: 'same' }), 'same')).toBe(
      'revoked',
    );
  });
});

describe('evaluateConnectability', () => {
  it('returns ok when neither party has a couple_id', () => {
    expect(evaluateConnectability(null, null)).toBe('ok');
  });

  it('returns inviter-already-connected when only the inviter has a couple_id', () => {
    expect(evaluateConnectability('couple-1', null)).toBe('inviter-already-connected');
  });

  it('returns accepter-already-connected when only the viewer/accepter has a couple_id', () => {
    expect(evaluateConnectability(null, 'couple-2')).toBe('accepter-already-connected');
  });

  it('checks the inviter first when both already have a couple_id', () => {
    expect(evaluateConnectability('couple-1', 'couple-2')).toBe('inviter-already-connected');
  });
});
