import { describe, expect, it } from 'vitest';
import { daysTogether } from '../relationship';

describe('daysTogether — 함께한 날짜(한국식, 첫날이 1일)', () => {
  it('만난 첫날은 1일이다(시각이 달라도)', () => {
    expect(daysTogether('2026-09-09', new Date('2026-09-09T00:10:00'))).toBe(1);
    expect(daysTogether('2026-09-09', new Date('2026-09-09T23:50:00'))).toBe(1);
  });

  it('다음 날은 2일이다', () => {
    expect(daysTogether('2026-09-09', new Date('2026-09-10T01:00:00'))).toBe(2);
  });

  it('시작일로부터 99일 뒤가 100일이다', () => {
    expect(daysTogether('2026-01-01', new Date('2026-04-10T12:00:00'))).toBe(100);
  });

  it('날짜 형식이 잘못되면 오류를 낸다', () => {
    expect(() => daysTogether('2026/01/01')).toThrow();
  });
});
