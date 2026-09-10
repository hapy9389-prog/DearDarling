import type { UserSettings } from '../types';
import { createDefaultTrialUserSettings, createDefaultUserSettings } from '../domain/consent';
import { isReviewUser } from '../fixtures/accounts';
import { readJSON, userKey, writeJSON } from '../storage';

/**
 * 설정은 항상 사용자 범위(userKey)에 저장된다 — 테스트 계정을 전환해도
 * 다른 사람의 동의·표시 설정·초안 도움 여부가 섞이지 않는다.
 * 실제 API가 생기면 이 인터페이스의 구현체만 HTTP 호출로 교체하면 된다.
 */
export interface SettingsService {
  getSettings(userId: string): UserSettings;
  updateSettings(userId: string, patch: Partial<Omit<UserSettings, 'userId'>>): UserSettings;
}

function storageKey(userId: string): string {
  return userKey(userId, 'settings');
}

/**
 * 저장된 설정이 없을 때의 기본값. 민준·서연(검토 계정)은 예전처럼 동의 켜짐,
 * 신규 체험 사용자는 동의 꺼짐으로 시작한다(0010).
 */
function defaultSettings(userId: string): UserSettings {
  return isReviewUser(userId)
    ? createDefaultUserSettings(userId)
    : createDefaultTrialUserSettings(userId);
}

export function createMockSettingsService(): SettingsService {
  return {
    getSettings(userId) {
      return readJSON<UserSettings>(storageKey(userId), defaultSettings(userId));
    },
    updateSettings(userId, patch) {
      const current = readJSON<UserSettings>(storageKey(userId), defaultSettings(userId));
      const next: UserSettings = { ...current, ...patch, userId };
      writeJSON(storageKey(userId), next);
      return next;
    },
  };
}
