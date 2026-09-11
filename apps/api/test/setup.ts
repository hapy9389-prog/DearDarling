/**
 * 모든 테스트 파일 실행 전에 한 번 로드된다(vitest.config.ts의 setupFiles).
 * 접속 대상 DB 이름이 "_test"로 끝나지 않으면 즉시 중단해, 실 데이터가 있는 DB를
 * 실수로 초기화·삭제하는 사고를 막는다.
 */
import { loadDotEnv } from '../src/config/loadDotEnv';

loadDotEnv(); // apps/api/.env — 이미 셸/CI에 설정된 값은 덮어쓰지 않는다.

function assertUsingTestDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `테스트는 반드시 "_test"로 끝나는 데이터베이스에서만 실행할 수 있습니다 (현재: "${dbName}"). ` +
        'TEST_DATABASE_URL을 확인하세요 — 운영/개발 DB를 실수로 지우는 것을 막기 위한 안전장치입니다.',
    );
  }
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL 환경변수가 필요합니다 (.env.example 참고).');
}
assertUsingTestDatabase(testDatabaseUrl);

// 테스트 코드 전체가 DATABASE_URL을 읽도록 통일 — 실제 값은 항상 테스트 DB를 가리킨다.
process.env.DATABASE_URL = testDatabaseUrl;
