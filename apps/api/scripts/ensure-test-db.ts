import { Client } from 'pg';
import { loadDotEnv } from '../src/config/loadDotEnv';

/**
 * TEST_DATABASE_URL이 가리키는 데이터베이스가 없으면 만든다. 이름이 "_test"로 끝나는지도
 * 여기서 한 번 더 확인한다 — 실 데이터가 있는 DB를 실수로 대상으로 잡는 것을 막기 위해서다.
 */
async function main() {
  loadDotEnv(); // apps/api/.env — 이미 셸에 설정된 값은 덮어쓰지 않는다.
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL 환경변수가 필요합니다.');

  const url = new URL(testUrl);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL의 데이터베이스 이름은 "_test"로 끝나야 합니다 (현재: "${dbName}").`,
    );
  }
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`데이터베이스 이름에 허용되지 않는 문자가 있습니다: "${dbName}"`);
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`생성됨: ${dbName}`);
    } else {
      console.log(`이미 존재함: ${dbName}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
