/**
 * 사귀기 시작한 날부터 오늘까지 "함께한 일수".
 * 한국식으로 만난 첫날을 1일로 센다(100일 = 시작일로부터 99일 뒤).
 *
 * @param startDateISO 'YYYY-MM-DD'
 * @param now 기준 시각(기본: 현재) — 테스트에서 고정값을 넣을 수 있게 받는다.
 */
export function daysTogether(startDateISO: string, now: Date = new Date()): number {
  const [year, month, day] = startDateISO.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`날짜 형식이 올바르지 않습니다(YYYY-MM-DD): ${startDateISO}`);
  }
  const startMidnight = new Date(year, month - 1, day).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const elapsedDays = Math.round((nowMidnight - startMidnight) / 86_400_000);
  return elapsedDays + 1;
}
