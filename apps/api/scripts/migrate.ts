import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { loadDotEnv } from '../src/config/loadDotEnv';

async function main() {
  loadDotEnv(); // apps/api/.env — 이미 셸에 설정된 값은 덮어쓰지 않는다.
  const isTest = process.argv.includes('--test');
  const connectionString = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(`${isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} 환경변수가 필요합니다.`);
  }

  const pool = createPool(connectionString);
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length ? `적용된 마이그레이션: ${applied.join(', ')}` : '이미 최신 상태입니다.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
