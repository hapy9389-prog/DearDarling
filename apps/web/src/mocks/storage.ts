// 로컬(localStorage) 저장을 커플 범위/사용자 범위로 구분하는 헬퍼.
// 메시지처럼 두 사람이 함께 보는 데이터는 coupleKey, 초안·코칭·설정처럼 개인 데이터는 userKey를 쓴다.
// 테스트 계정을 전환해도 userKey 네임스페이스가 다르므로 서로 섞이지 않는다.

const NAMESPACE = 'deardarling:mock:v1';

export function coupleKey(coupleId: string, key: string): string {
  return `${NAMESPACE}:couple:${coupleId}:${key}`;
}

export function userKey(userId: string, key: string): string {
  return `${NAMESPACE}:user:${userId}:${key}`;
}

/** 특정 계정/커플에 속하지 않는 리뷰어 전용 상태(현재 보는 계정, 활성 시나리오 등). */
export function devKey(key: string): string {
  return `${NAMESPACE}:dev:${key}`;
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 공간이 없거나 접근이 막힌 경우, 화면 검토 단계에서는 조용히 무시한다.
  }
}

/** 가상 데이터를 모두 초기 시드 상태로 되돌린다. 이 앱이 만든 키만 지운다. */
export function resetAllMockData(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(NAMESPACE)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
