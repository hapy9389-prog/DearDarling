import { afterEach, describe, expect, it } from 'vitest';
import { createMockInviteService } from '../inviteService';
import { createMockAuthService } from '../authService';
import { createMockRelationshipService } from '../relationshipService';
import type { Invite } from '../../types';
import { resetAllMockData, trialKey, writeJSON } from '../../storage';

const invites = createMockInviteService();
const auth = createMockAuthService();

afterEach(() => {
  resetAllMockData();
});

async function makeUser(email: string, nickname = '가온') {
  return auth.createUser({ email, nickname });
}

describe('inviteService — 코드 생성', () => {
  it('pending 초대를 만들고, 두 번째 생성은 첫 번째를 취소한다', async () => {
    const a = await makeUser('a@a.com');
    const first = await invites.createInvite(a.id);
    expect(first.ok).toBe(true);
    const second = await invites.createInvite(a.id);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(invites.lookupInvite(first.invite.code, 'other')).toMatchObject({ status: 'revoked' });
    expect(invites.getActiveInvite(a.id)?.code).toBe(second.invite.code);
  });

  it('이미 연결된 사람은 초대를 만들 수 없다', async () => {
    const a = await makeUser('a@a.com');
    auth.connectCouple(a.id, 'someone', 'trial-couple-x');
    expect(await invites.createInvite(a.id)).toMatchObject({
      ok: false,
      code: 'already-connected',
    });
  });
});

describe('inviteService — 코드 확인', () => {
  it('상태별 결과', async () => {
    const a = await makeUser('a@a.com', '가온');
    const b = await makeUser('b@b.com', '나린');
    const created = await invites.createInvite(a.id);
    if (!created.ok) throw new Error('초대 생성 실패');

    expect(invites.lookupInvite('DD-ZZZZZZ', b.id)).toMatchObject({ status: 'not-found' });
    expect(invites.lookupInvite(created.invite.code, a.id)).toMatchObject({ status: 'self' });
    expect(invites.lookupInvite(created.invite.code, b.id)).toMatchObject({
      status: 'ok',
      inviterNickname: '가온',
    });

    const c = await makeUser('c@c.com');
    auth.connectCouple(b.id, c.id, 'trial-couple-y');
    expect(invites.lookupInvite(created.invite.code, b.id)).toMatchObject({
      status: 'accepter-already-connected',
    });
  });

  it('만료된 코드', async () => {
    const a = await makeUser('a@a.com');
    const b = await makeUser('b@b.com');
    const past: Invite = {
      code: 'DD-EXPIRE',
      inviterUserId: a.id,
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-04T00:00:00.000Z', // 이미 지남
      status: 'pending',
      accepterUserId: null,
    };
    writeJSON(trialKey('invites'), [past]);
    expect(invites.lookupInvite('DD-EXPIRE', b.id)).toMatchObject({ status: 'expired' });
  });
});

describe('inviteService — 수락', () => {
  it('두 사람을 한 coupleId로 연결하고 커플 프로필을 기록한다', async () => {
    const a = await makeUser('a@a.com');
    const b = await makeUser('b@b.com');
    const created = await invites.createInvite(a.id);
    if (!created.ok) throw new Error('초대 생성 실패');

    const result = await invites.acceptInvite(created.invite.code, b.id, {
      relationshipStartDate: '2025-03-03',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const userA = auth.getUser(a.id)!;
    const userB = auth.getUser(b.id)!;
    expect(userA.coupleId).toBe(result.coupleId);
    expect(userB.coupleId).toBe(result.coupleId);
    expect(userA.partnerUserId).toBe(b.id);

    const profile = createMockRelationshipService().getCoupleProfile(result.coupleId);
    expect(profile.relationshipStartDate).toBe('2025-03-03');
    expect(profile.connectedAt).toBeTruthy();

    // 재수락은 거부
    const again = await invites.acceptInvite(created.invite.code, b.id);
    expect(again).toMatchObject({ ok: false, reason: 'already-accepted' });
  });

  it('시작일을 넘기지 않으면 커플 프로필의 relationshipStartDate는 null', async () => {
    const a = await makeUser('a@a.com');
    const b = await makeUser('b@b.com');
    const created = await invites.createInvite(a.id);
    if (!created.ok) throw new Error('초대 생성 실패');
    const result = await invites.acceptInvite(created.invite.code, b.id);
    if (!result.ok) return;
    expect(
      createMockRelationshipService().getCoupleProfile(result.coupleId).relationshipStartDate,
    ).toBeNull();
  });

  it('A·B·C 흐름: A가 연결된 뒤 남은 A의 코드를 C가 못 쓴다(회귀)', async () => {
    const a = await makeUser('a@a.com', '가온');
    const b = await makeUser('b@b.com', '나린');
    const c = await makeUser('c@c.com', '다온');

    const codeA = await invites.createInvite(a.id);
    const codeB = await invites.createInvite(b.id);
    if (!codeA.ok || !codeB.ok) throw new Error('초대 생성 실패');

    // A가 B의 코드로 연결 → A·B 커플
    const abResult = await invites.acceptInvite(codeB.invite.code, a.id);
    expect(abResult.ok).toBe(true);
    if (!abResult.ok) return;

    // A의 남은 코드는 연결 완료 시 무효화된다
    expect(invites.getActiveInvite(a.id)).toBeNull();

    // C가 A의 코드를 쓰려 하면 거절되고(무효화됐거나 초대자가 이미 연결됨), A·B 커플 정보는 그대로다
    const cLookup = invites.lookupInvite(codeA.invite.code, c.id);
    expect(cLookup.status).not.toBe('ok');
    const cTry = await invites.acceptInvite(codeA.invite.code, c.id);
    expect(cTry.ok).toBe(false);

    const userA = auth.getUser(a.id)!;
    const userB = auth.getUser(b.id)!;
    const userC = auth.getUser(c.id)!;
    expect(userA.coupleId).toBe(abResult.coupleId);
    expect(userB.coupleId).toBe(abResult.coupleId);
    expect(userA.partnerUserId).toBe(b.id);
    expect(userB.partnerUserId).toBe(a.id);
    expect(userC.coupleId).toBeNull(); // C는 연결되지 않음
  });

  it('초대자가 이미 연결됐지만 코드가 남아 있으면 inviter-already-connected로 막는다', async () => {
    const a = await makeUser('a@a.com');
    const c = await makeUser('c@c.com');
    // pending 초대를 직접 심고, A를 다른 커플로 연결시킨다(초대는 revoke되지 않은 상태).
    const past: Invite = {
      code: 'DD-LEFTOV',
      inviterUserId: a.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'pending',
      accepterUserId: null,
    };
    writeJSON(trialKey('invites'), [past]);
    auth.connectCouple(a.id, 'partner-of-a', 'trial-couple-a');

    expect(invites.lookupInvite('DD-LEFTOV', c.id)).toMatchObject({
      status: 'inviter-already-connected',
    });
    const tried = await invites.acceptInvite('DD-LEFTOV', c.id);
    expect(tried).toMatchObject({ ok: false, reason: 'inviter-already-connected' });
    expect(auth.getUser(c.id)!.coupleId).toBeNull();
  });

  it('연결 완료 시 수락자의 남은 활성 초대도 무효화된다', async () => {
    const a = await makeUser('a@a.com');
    const b = await makeUser('b@b.com');
    const codeA = await invites.createInvite(a.id);
    const codeB = await invites.createInvite(b.id);
    if (!codeA.ok || !codeB.ok) throw new Error('초대 생성 실패');

    await invites.acceptInvite(codeA.invite.code, b.id); // B가 A의 코드로 연결
    expect(invites.getActiveInvite(a.id)).toBeNull();
    expect(invites.getActiveInvite(b.id)).toBeNull();
  });

  it('거절된 수락 시도는 커플 정보를 만들지 않는다', async () => {
    const a = await makeUser('a@a.com');
    const b = await makeUser('b@b.com');
    const codeA = await invites.createInvite(a.id);
    if (!codeA.ok) throw new Error('초대 생성 실패');
    // A를 미리 다른 커플로 연결시켜 초대를 무력화
    auth.connectCouple(a.id, 'someone-else', 'trial-couple-existing');

    const result = await invites.acceptInvite(codeA.invite.code, b.id);
    expect(result.ok).toBe(false);
    expect(auth.getUser(b.id)!.coupleId).toBeNull();
    // A의 기존 커플은 그대로
    expect(auth.getUser(a.id)!.coupleId).toBe('trial-couple-existing');
  });
});
