import { createApp } from './app';
import { loadDotEnv } from './config/loadDotEnv';
import { loadEnv } from './config/env';
import { runMigrations } from './db/migrate';
import { createPool } from './db/pool';

async function main() {
  loadDotEnv(); // apps/api/.env — 이미 셸에 설정된 값은 덮어쓰지 않는다.
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);
  await runMigrations(pool);

  const app = createApp({ pool, localTestAuth: env.localTestAuth });

  // 127.0.0.1에만 바인딩 — 이 서버는 외부에 직접 노출하지 않는다(0.0.0.0로 바꾸지 말 것).
  app.listen(env.port, '127.0.0.1', () => {
    console.log(
      `apps/api listening on http://127.0.0.1:${env.port} (nodeEnv=${env.nodeEnv}, localTestAuth=${env.localTestAuth})`,
    );
  });
}

main().catch((err) => {
  console.error('서버 기동 실패:', err);
  process.exitCode = 1;
});
