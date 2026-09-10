import type { Invite } from '../types';
import { mockDelay } from '../delay';
import { deriveStatus, generateCode, INVITE_TTL_MS, normalizeCode } from '../domain/invite';
import { newTrialCoupleId } from '../fixtures/trial';
import { readJSON, trialKey, writeJSON } from '../storage';
import { createMockAuthService } from './authService';
import { createMockRelationshipService } from './relationshipService';

/**
 * 연인 연결 초대(0010). **가상 처리** — 실시간 알림이 없으므로 상대가 코드를 입력할 때까지
 * 화면에서 "연결 상태 확인"을 눌러 갱신한다. 실제 API가 붙으면 서버 발급 토큰 + 푸시로 교체한다.
 */
export interface CreateInviteResult {
  ok: true;
  invite: Invite;
}
export interface CreateInviteError {
  ok: false;
  code: 'already-connected';
  message: string;
}

export type LookupResult =
  | { status: 'ok'; code: string; inviterNickname: string; inviterAvatar: string }
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'revoked' }
  | { status: 'already-accepted' }
  | { status: 'self' }
  | { status: 'accepter-already-connected' }
  | { status: 'inviter-already-connected' };

export interface AcceptResult {
  ok: true;
  coupleId: string;
  partnerUserId: string;
}
export interface AcceptError {
  ok: false;
  reason: Exclude<LookupResult['status'], 'ok'>;
}

export interface InviteService {
  createInvite(inviterUserId: string): Promise<CreateInviteResult | CreateInviteError>;
  getActiveInvite(inviterUserId: string): Invite | null;
  lookupInvite(code: string, accepterUserId: string): LookupResult;
  acceptInvite(
    code: string,
    accepterUserId: string,
    options?: { relationshipStartDate?: string | null },
  ): Promise<AcceptResult | AcceptError>;
  revokeInvite(code: string): void;
}

const INVITES_KEY = trialKey('invites');

function loadInvites(): Invite[] {
  return readJSON<Invite[]>(INVITES_KEY, []);
}

function saveInvites(invites: Invite[]): void {
  writeJSON(INVITES_KEY, invites);
}

export function createMockInviteService(): InviteService {
  const authService = createMockAuthService();
  const relationshipService = createMockRelationshipService();

  function activeInviteFor(inviterUserId: string, now = new Date()): Invite | null {
    return (
      loadInvites().find(
        (invite) =>
          invite.inviterUserId === inviterUserId && deriveStatus(invite, now) === 'pending',
      ) ?? null
    );
  }

  function findByCode(code: string): Invite | undefined {
    const normalized = normalizeCode(code);
    return loadInvites().find((invite) => invite.code === normalized);
  }

  function evaluate(code: string, accepterUserId: string): LookupResult {
    const invite = findByCode(code);
    if (!invite) return { status: 'not-found' };
    if (invite.inviterUserId === accepterUserId) return { status: 'self' };

    const status = deriveStatus(invite);
    if (status === 'expired') return { status: 'expired' };
    if (status === 'revoked') return { status: 'revoked' };
    if (status === 'accepted') return { status: 'already-accepted' };

    // 초대자·수락자가 모두 존재하고, 모두 아직 미연결이어야 한다.
    // (초대자가 자기 다른 코드로 이미 연결된 뒤 남은 코드를 제3자가 쓰는 경우를 막는다.)
    const inviter = authService.getUser(invite.inviterUserId);
    const accepter = authService.getUser(accepterUserId);
    if (!inviter || !accepter) return { status: 'not-found' };
    if (accepter.coupleId) return { status: 'accepter-already-connected' };
    if (inviter.coupleId) return { status: 'inviter-already-connected' };

    return {
      status: 'ok',
      code: invite.code,
      inviterNickname: inviter.nickname || '상대',
      inviterAvatar: inviter.avatarEmoji || '🙂',
    };
  }

  return {
    async createInvite(inviterUserId) {
      await mockDelay(700);
      const inviter = authService.getUser(inviterUserId);
      if (inviter?.coupleId) {
        return {
          ok: false,
          code: 'already-connected',
          message: '이미 다른 사람과 연결돼 있어요.',
        };
      }

      const now = new Date();
      // 사용자당 활성 초대는 하나 — 이전 pending 초대는 취소한다.
      const invites = loadInvites().map((invite) =>
        invite.inviterUserId === inviterUserId && deriveStatus(invite, now) === 'pending'
          ? { ...invite, status: 'revoked' as const }
          : invite,
      );

      const invite: Invite = {
        code: generateCode(),
        inviterUserId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
        status: 'pending',
        accepterUserId: null,
      };
      saveInvites([...invites, invite]);
      return { ok: true, invite };
    },

    getActiveInvite(inviterUserId) {
      return activeInviteFor(inviterUserId);
    },

    lookupInvite(code, accepterUserId) {
      return evaluate(code, accepterUserId);
    },

    async acceptInvite(code, accepterUserId, options) {
      await mockDelay(700);
      // 지연 뒤 다시 검증한다 — 그 사이 초대자·수락자가 다른 경로로 연결됐을 수 있다.
      // 거절되면 여기서 끝 — 커플 정보를 만들거나 바꾸지 않는다.
      const check = evaluate(code, accepterUserId);
      if (check.status !== 'ok') return { ok: false, reason: check.status };

      const invite = findByCode(code)!;
      const coupleId = newTrialCoupleId();

      authService.connectCouple(invite.inviterUserId, accepterUserId, coupleId);
      relationshipService.updateCoupleProfile(coupleId, {
        relationshipStartDate: options?.relationshipStartDate ?? null,
      });

      // 이 초대는 accepted로, 두 사람의 다른 활성(pending) 초대는 모두 무효화한다.
      const now = new Date();
      saveInvites(
        loadInvites().map((entry) => {
          if (entry.code === invite.code) {
            return { ...entry, status: 'accepted' as const, accepterUserId };
          }
          const belongsToPair =
            entry.inviterUserId === invite.inviterUserId || entry.inviterUserId === accepterUserId;
          if (belongsToPair && deriveStatus(entry, now) === 'pending') {
            return { ...entry, status: 'revoked' as const };
          }
          return entry;
        }),
      );

      return { ok: true, coupleId, partnerUserId: invite.inviterUserId };
    },

    revokeInvite(code) {
      const normalized = normalizeCode(code);
      saveInvites(
        loadInvites().map((invite) =>
          invite.code === normalized ? { ...invite, status: 'revoked' as const } : invite,
        ),
      );
    },
  };
}
