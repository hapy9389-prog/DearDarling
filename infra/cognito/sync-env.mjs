#!/usr/bin/env node
// apps/api/.env에 KEY=값을 안전하게 반영한다. 기존 줄이 있는지 판단하는 규칙은
// apps/api/src/config/loadDotEnv.ts(서버가 .env를 읽는 방식)와 반드시 같아야 한다 — 그렇지
// 않으면 예를 들어 "KEY = 기존값"(공백 포함)처럼 서버는 인식하는 줄을 이 도구가 못 알아보고
// 새 줄을 추가해, 서버는 여전히 첫 번째(기존) 줄을 쓰고 이 도구가 추가한 줄은 무시되는 문제가
// 생긴다. 그래서 판단은 env-lib.mjs(loadDotEnv.ts와 동일한 파서)를 그대로 쓴다.
//
// - .env가 없으면 .env.example에서 새로 만든다.
// - 같은 키로 판단되는 줄이 여러 개면(공백·따옴표 형태가 달라도) 첫 번째 줄의 위치에 새 값으로
//   합치고 나머지 중복 줄은 지운다 — 서버는 어차피 "첫 번째" 줄만 쓰므로 정리해도 안전하다.
// - 임시 파일에 전체 내용을 다 쓴 뒤 rename으로 교체한다(중간에 실패해도 원본 .env가 반쪽
//   상태로 남지 않는다).
// - 값은 인자로 직접 받지 않는다(ps로 다른 프로세스에 보일 수 있어서) — "KEY=값이_담긴_파일경로"
//   형태만 받는다.
// - 어떤 경우에도 값 자체를 표준출력/표준에러에 찍지 않는다(키 이름만 찍는다).

import {
  readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync, unlinkSync, renameSync,
} from 'node:fs';
import { parseEnvLines } from './env-lib.mjs';

const [, , envPath, envExamplePath, ...pairs] = process.argv;

if (!envPath || !envExamplePath || pairs.length === 0) {
  console.error('사용법: node sync-env.mjs <.env 경로> <.env.example 경로> KEY=값파일경로 ...');
  process.exit(1);
}

if (!existsSync(envPath)) {
  if (!existsSync(envExamplePath)) {
    console.error(`.env도 .env.example도 없습니다: ${envExamplePath}`);
    process.exit(1);
  }
  copyFileSync(envExamplePath, envPath);
  chmodSync(envPath, 0o600);
  console.log(`[sync-env] ${envPath}가 없어 .env.example에서 새로 만들었습니다.`);
}

let rawLines = readFileSync(envPath, 'utf8').split('\n');
const updatedKeys = [];
const addedKeys = [];

for (const pair of pairs) {
  const eq = pair.indexOf('=');
  if (eq < 0) {
    console.error(`잘못된 인자(KEY=파일경로 형식이어야 함): ${pair}`);
    process.exit(1);
  }
  const key = pair.slice(0, eq);
  const valueFilePath = pair.slice(eq + 1);
  if (!existsSync(valueFilePath)) {
    console.error(`${key}의 값 파일이 없습니다: ${valueFilePath}`);
    process.exit(1);
  }
  const value = readFileSync(valueFilePath, 'utf8').trim();
  if (!value) {
    console.error(`${key}의 값 파일이 비어 있습니다: ${valueFilePath}`);
    process.exit(1);
  }

  // 서버(loadDotEnv)와 같은 규칙으로 이 키에 해당하는 줄을 찾는다(공백·따옴표 무관).
  const parsed = parseEnvLines(rawLines.join('\n'));
  const matchIdxs = parsed
    .map((l, idx) => (l.key === key ? idx : -1))
    .filter((idx) => idx !== -1);
  const existedBefore = matchIdxs.length > 0;

  if (existedBefore) {
    const firstIdx = matchIdxs[0];
    // 중복 줄은 뒤에서부터 제거(첫 줄보다 항상 뒤에 있으므로 firstIdx 인덱스는 안 밀린다).
    for (let k = matchIdxs.length - 1; k >= 1; k--) {
      rawLines.splice(matchIdxs[k], 1);
    }
    rawLines[firstIdx] = `${key}=${value}`;
  } else {
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] !== '') rawLines.push('');
    rawLines.push(`${key}=${value}`);
  }

  (existedBefore ? updatedKeys : addedKeys).push(key);
}

const tmpPath = `${envPath}.tmp.${process.pid}`;
const content = rawLines.join('\n').replace(/\n*$/, '\n'); // 파일 끝에 개행 하나만 남긴다
writeFileSync(tmpPath, content, { mode: 0o600 });
chmodSync(tmpPath, 0o600);
renameSync(tmpPath, envPath); // 같은 파일시스템 내 rename은 원자적 — 반쪽 상태로 남지 않는다
chmodSync(envPath, 0o600);

for (const pair of pairs) {
  const valueFilePath = pair.slice(pair.indexOf('=') + 1);
  try { unlinkSync(valueFilePath); } catch { /* 이미 지워졌으면 무시 */ }
}

console.log(`[sync-env] 갱신된 키: ${updatedKeys.join(', ') || '(없음)'}`);
console.log(`[sync-env] 새로 추가된 키: ${addedKeys.join(', ') || '(없음)'}`);
console.log(`[sync-env] ${envPath} 권한을 600으로 설정했습니다. 값 자체는 출력하지 않습니다.`);
