import type { Invite, TrialUser } from '../mocks/types';
import { INVITE_TTL_MS } from '../mocks/domain/invite';
import { createMockAuthService } from '../mocks/services/authService';
import { createMockRelationshipService } from '../mocks/services/relationshipService';
import { trialKey, writeJSON } from '../mocks/storage';

const USERS_KEY = trialKey('users');
const INVITES_KEY = trialKey('invites');

/** 통합 테스트에서 `renderApp({ session })`로 넘길 세션 시드. */
export type SeededSession =
  | { kind: 'review'; accountId: 'user-minjun' | 'user-seoyeon' }
  | { kind: 'trial'; userId: string }
  | { kind: 'real'; userId: string };

/** 기존 민준·서연 검토 모드 세션(대부분의 기존 통합 테스트가 이걸 쓴다). */
export function seedReviewSession(
  accountId: 'user-minjun' | 'user-seoyeon' = 'user-minjun',
): SeededSession {
  return { kind: 'review', accountId };
}

let trialCounter = 0;

function readUsers(): TrialUser[] {
  return createMockAuthService().listUsers();
}

/** 체험 사용자 한 명을 localStorage에 심는다(가입 흐름을 건너뛰고 특정 상태에서 시작). */
export function seedTrialUser(overrides: Partial<TrialUser> = {}): TrialUser {
  trialCounter += 1;
  const user: TrialUser = {
    id: overrides.id ?? `trial-user-seed${trialCounter}`,
    email: overrides.email ?? `seed${trialCounter}@trial.local`,
    nickname: overrides.nickname ?? '',
    avatarEmoji: overrides.avatarEmoji ?? '🦊',
    coupleId: overrides.coupleId ?? null,
    partnerUserId: overrides.partnerUserId ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
  const others = readUsers().filter((u) => u.id !== user.id);
  writeJSON(USERS_KEY, [...others, user]);
  return user;
}

/** 닉네임까지 정한(프로필 완료) 미연결 체험 사용자. */
export function seedProfileCompleteTrialUser(nickname = '테스트'): TrialUser {
  return seedTrialUser({ nickname });
}

/** 연결된 체험 커플(A·B). 반환값의 `a.id`로 trial 세션을 만들면 된다. */
export function seedConnectedTrialCouple(): { a: TrialUser; b: TrialUser; coupleId: string } {
  trialCounter += 1;
  const coupleId = `trial-couple-seed${trialCounter}`;
  const a = seedTrialUser({ nickname: '가온', coupleId });
  const b = seedTrialUser({ nickname: '나린', coupleId });
  const linked = readUsers().map((u) =>
    u.id === a.id
      ? { ...u, partnerUserId: b.id }
      : u.id === b.id
        ? { ...u, partnerUserId: a.id }
        : u,
  );
  writeJSON(USERS_KEY, linked);
  createMockRelationshipService().updateCoupleProfile(coupleId, { relationshipStartDate: null });
  return {
    a: { ...a, partnerUserId: b.id },
    b: { ...b, partnerUserId: a.id },
    coupleId,
  };
}

/** 특정 사용자가 만든 pending 초대를 심는다. */
export function seedPendingInvite(inviter: TrialUser, code = 'DD-SEED01'): Invite {
  const now = Date.now();
  const invite: Invite = {
    code,
    inviterUserId: inviter.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    status: 'pending',
    accepterUserId: null,
  };
  writeJSON(INVITES_KEY, [invite]);
  return invite;
}
