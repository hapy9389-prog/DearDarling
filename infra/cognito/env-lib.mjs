#!/usr/bin/env node
// apps/api/src/config/loadDotEnv.ts와 완전히 같은 규칙으로 .env를 읽는다 — 준비 도구가 서버와
// 다른 규칙(공백·따옴표·중복 키 처리)으로 같은 파일을 다르게 해석하면 안 되기 때문이다.
//
// 서버 규칙(loadDotEnv.ts 그대로 옮김):
// - 줄 전체를 trim한다. 비었거나 '#'로 시작하면 무시한다.
// - 첫 '=' 기준으로 key/value를 나눈다. key도 trim한다. key가 비면 무시한다.
// - value도 trim한 뒤, 양끝이 같은 종류의 따옴표(' 또는 ")로 감싸여 있으면 그 한 겹만 벗긴다.
// - **같은 키가 여러 번 나오면 "처음" 값이 유효하다** — 서버는 이미 설정된(첫 줄에서 읽은) 값을
//   덮어쓰지 않기 때문이다.
//
// 이 파일은 라이브러리(다른 .mjs가 import)이자 CLI(`node env-lib.mjs get <.env경로> <KEY>`)다.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function parseEnvLines(content) {
  return content.split('\n').map((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return { raw: rawLine, key: null, value: null };
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) return { raw: rawLine, key: null, value: null };
    const key = line.slice(0, eqIndex).trim();
    if (!key) return { raw: rawLine, key: null, value: null };
    let value = line.slice(eqIndex + 1).trim();
    const isQuoted =
      (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) ||
      (value.length >= 2 && value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);
    return { raw: rawLine, key, value };
  });
}

/** 서버와 동일하게 "키마다 첫 번째 값"만 유효한 Map을 만든다. */
export function effectiveValues(content) {
  const map = new Map();
  for (const l of parseEnvLines(content)) {
    if (l.key && !map.has(l.key)) map.set(l.key, l.value);
  }
  return map;
}

/** 파일이 없으면 undefined. 키가 없어도 undefined. */
export function getEffectiveValue(envPath, key) {
  let content;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    return undefined;
  }
  return effectiveValues(content).get(key);
}

// ── CLI ──────────────────────────────────────────────────────────────────
// import.meta.url은 심볼릭 링크를 실제 경로로 풀어서 보여줄 수 있다(macOS의 /var가
// /private/var로 풀리는 경우 등) — process.argv[1]과 문자열로만 비교하면 임시 디렉터리
// (mktemp가 만드는 경로 등)에서 이 스크립트를 직접 실행해도 "메인 모듈"로 인식하지 못해
// CLI가 조용히 아무 것도 안 하고 성공 종료하는 문제가 생긴다. 둘 다 realpath로 정규화해 비교한다.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (isMain) {
  const [, , cmd, envPath, key] = process.argv;
  if (cmd === 'get' && envPath && key) {
    const v = getEffectiveValue(envPath, key);
    if (v === undefined) {
      process.exit(1); // 값 없음 — 표준출력에는 아무것도 안 씀(빈 문자열과 구분하기 위해 exit code로 구분)
    }
    process.stdout.write(v);
  } else {
    console.error('사용법: node env-lib.mjs get <.env 경로> <KEY>');
    process.exit(2);
  }
}
