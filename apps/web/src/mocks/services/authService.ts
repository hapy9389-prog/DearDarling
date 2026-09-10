import type { TrialUser } from '../types';
import { mockDelay } from '../delay';
import { normalizeEmail, validateEmail, validatePassword } from '../domain/auth';
import { DEFAULT_TRIAL_AVATAR, newTrialUserId } from '../fixtures/trial';
import { readJSON, trialKey, writeJSON } from '../storage';
import { createMockSettingsService } from './settingsService';

/**
 * 신규 체험 가입·로그인(0010). **가상 처리** — 실제 인증·이메일 발송은 없다.
 *  - 비밀번호는 형식 검증에만 쓰고 저장하지 않는다(TrialUser에 필드 자체가 없다).
 *  - "검증" = 이메일이 등록돼 있고 비밀번호가 형식 검증을 통과 (저장된 비밀번호와 대조하지 않는다).
 * 실제 API가 붙으면 이 인터페이스 구현체만 HTTP 호출로 교체한다.
 */
export interface AuthOk {
  ok: true;
  userId: string;
}
export interface AuthError {
  ok: false;
  code: 'email-taken' | 'no-account' | 'invalid-email' | 'invalid-password';
  message: string;
}
export type AuthResult = AuthOk | AuthError;

export interface AuthService {
  signUp(input: { email: string; password: string }): Promise<AuthResult>;
  logIn(input: { email: string; password: string }): Promise<AuthResult>;
  requestPasswordReset(input: { email: string }): Promise<{ ok: boolean; message: string }>;
  getUser(userId: string): TrialUser | undefined;
  getUserByEmail(email: string): TrialUser | undefined;
  listUsers(): TrialUser[];
  createUser(input: { email: string; nickname?: string; avatarEmoji?: string }): TrialUser;
  updateProfile(userId: string, patch: { nickname?: string; avatarEmoji?: string }): TrialUser;
  connectCouple(userId: string, partnerUserId: string, coupleId: string): void;
  disconnectCouple(userId: string): void;
}

const USERS_KEY = trialKey('users');

function loadUsers(): TrialUser[] {
  return readJSON<TrialUser[]>(USERS_KEY, []);
}

function saveUsers(users: TrialUser[]): void {
  writeJSON(USERS_KEY, users);
}

const settingsService = createMockSettingsService();

export function createMockAuthService(): AuthService {
  function findByEmail(email: string): TrialUser | undefined {
    const normalized = normalizeEmail(email);
    return loadUsers().find((u) => u.email === normalized);
  }

  function persistNewUser(input: {
    email: string;
    nickname?: string;
    avatarEmoji?: string;
  }): TrialUser {
    const user: TrialUser = {
      id: newTrialUserId(),
      email: normalizeEmail(input.email),
      nickname: input.nickname ?? '',
      avatarEmoji: input.avatarEmoji ?? DEFAULT_TRIAL_AVATAR,
      coupleId: null,
      partnerUserId: null,
      createdAt: new Date().toISOString(),
    };
    saveUsers([...loadUsers(), user]);
    // 서버가 user를 만들 때 analysis_consent=false로 두는 동작을 흉내낸다(가입과 동의 분리).
    settingsService.updateSettings(user.id, {
      analysisConsent: false,
      coachingVisible: true,
      draftHelpEnabled: false,
    });
    return user;
  }

  function mutateUser(userId: string, update: (user: TrialUser) => TrialUser): TrialUser {
    const users = loadUsers();
    const index = users.findIndex((u) => u.id === userId);
    if (index === -1) throw new Error(`체험 사용자를 찾을 수 없어요: ${userId}`);
    const next = update(users[index]!);
    const copy = [...users];
    copy[index] = next;
    saveUsers(copy);
    return next;
  }

  return {
    async signUp({ email, password }) {
      await mockDelay(700);
      const emailCheck = validateEmail(email);
      if (!emailCheck.ok) {
        return { ok: false, code: 'invalid-email', message: emailCheck.message ?? '' };
      }
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.ok) {
        return { ok: false, code: 'invalid-password', message: passwordCheck.message ?? '' };
      }
      if (findByEmail(email)) {
        return { ok: false, code: 'email-taken', message: '이미 가입된 이메일이에요.' };
      }
      const user = persistNewUser({ email });
      return { ok: true, userId: user.id };
    },

    async logIn({ email, password }) {
      await mockDelay(700);
      const emailCheck = validateEmail(email);
      if (!emailCheck.ok) {
        return { ok: false, code: 'invalid-email', message: emailCheck.message ?? '' };
      }
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.ok) {
        return { ok: false, code: 'invalid-password', message: passwordCheck.message ?? '' };
      }
      const user = findByEmail(email);
      if (!user) {
        return { ok: false, code: 'no-account', message: '가입된 계정을 찾을 수 없어요.' };
      }
      return { ok: true, userId: user.id };
    },

    async requestPasswordReset({ email }) {
      await mockDelay(700);
      const check = validateEmail(email);
      if (!check.ok) return { ok: false, message: check.message ?? '' };
      // 계정 존재 여부를 노출하지 않는다 — 등록/미등록 모두 같은 안내.
      return {
        ok: true,
        message: '재설정 링크를 보냈어요 (예시). 실제 메일은 보내지 않아요.',
      };
    },

    getUser(userId) {
      return loadUsers().find((u) => u.id === userId);
    },

    getUserByEmail(email) {
      return findByEmail(email);
    },

    listUsers() {
      return loadUsers();
    },

    createUser(input) {
      return persistNewUser(input);
    },

    updateProfile(userId, patch) {
      return mutateUser(userId, (user) => ({
        ...user,
        nickname: patch.nickname ?? user.nickname,
        avatarEmoji: patch.avatarEmoji ?? user.avatarEmoji,
      }));
    },

    connectCouple(userId, partnerUserId, coupleId) {
      mutateUser(userId, (user) => ({ ...user, coupleId, partnerUserId }));
      // 상대가 아직 없을 수도 있는 검토용 경로(가상 상대)를 위해 없으면 조용히 건너뛴다.
      if (loadUsers().some((u) => u.id === partnerUserId)) {
        mutateUser(partnerUserId, (user) => ({ ...user, coupleId, partnerUserId: userId }));
      }
    },

    disconnectCouple(userId) {
      const user = loadUsers().find((u) => u.id === userId);
      if (!user) return;
      const partnerId = user.partnerUserId;
      mutateUser(userId, (u) => ({ ...u, coupleId: null, partnerUserId: null }));
      if (partnerId) {
        try {
          mutateUser(partnerId, (u) => ({ ...u, coupleId: null, partnerUserId: null }));
        } catch {
          // 상대가 이미 없으면 무시
        }
      }
    },
  };
}
