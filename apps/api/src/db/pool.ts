import { Pool, types } from 'pg';

// pg의 기본 DATE 파서는 로컬 타임존 자정 기준 Date 객체로 변환한다 — 서버가 KST(UTC+9)에서
// 돌면 relationship_start_date 같은 "시간 없는 순수 날짜"가 하루 밀려 보이는 버그가 생긴다
// (예: '2025-01-01' 저장 → 조회 시 '2024-12-31T15:00:00.000Z'). DATE(OID 1082)는 문자열
// 그대로 돌려받아 타임존 변환 자체가 끼어들지 않게 한다.
types.setTypeParser(1082, (value: string) => value);

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}
