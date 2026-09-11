import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 아주 단순한 .env 로더. `KEY=VALUE` 줄만 읽고, 이미 `process.env`에 값이 있으면
 * 그 값을 그대로 두고 건드리지 않는다(셸에서 export한 값이 항상 .env보다 우선한다).
 * 여러 줄 값·변수 치환 같은 기능은 없다 — 이 프로젝트의 .env.example 형태만 지원한다.
 *
 * 기준 경로는 호출 시점의 현재 작업 디렉터리(`process.cwd()`)다 — `apps/api` 안에서,
 * 또는 `pnpm --filter @deardarling/api <script>`로 실행했을 때(둘 다 cwd가 apps/api가 됨)
 * `apps/api/.env`를 찾는다.
 */
export function loadDotEnv(envPath: string = path.resolve(process.cwd(), '.env')): void {
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIndex + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);

    process.env[key] = value;
  }
}
