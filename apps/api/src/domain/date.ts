const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "YYYY-MM-DD" 형식이면서 실제로 존재하는 날짜인지 확인한다(예: 2025-02-30, 2025-13-01은
 * 형식은 맞아도 실존하지 않는 날짜라 거부해야 한다). `Date.UTC`로 만든 뒤 연·월·일이
 * 그대로 돌아오는지 대조하는 방식으로 확인한다 — JS Date는 존재하지 않는 날짜를 다음 날짜로
 * 자동 보정하므로(2025-02-30 → 2025-03-02), 이 보정이 일어났는지를 역으로 검사하는 셈이다.
 */
export function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
