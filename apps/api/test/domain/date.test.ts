import { describe, expect, it } from 'vitest';
import { isValidCalendarDate } from '../../src/domain/date';

describe('isValidCalendarDate', () => {
  it('accepts real calendar dates in YYYY-MM-DD format', () => {
    expect(isValidCalendarDate('2025-01-01')).toBe(true);
    expect(isValidCalendarDate('2024-02-29')).toBe(true); // 윤년
  });

  it('rejects dates that do not exist', () => {
    expect(isValidCalendarDate('2025-02-30')).toBe(false);
    expect(isValidCalendarDate('2025-13-01')).toBe(false);
    expect(isValidCalendarDate('2025-00-10')).toBe(false);
    expect(isValidCalendarDate('2023-02-29')).toBe(false); // 평년
  });

  it('rejects malformed or non-YYYY-MM-DD strings', () => {
    expect(isValidCalendarDate('')).toBe(false);
    expect(isValidCalendarDate('2025/01/01')).toBe(false);
    expect(isValidCalendarDate('01-01-2025')).toBe(false);
    expect(isValidCalendarDate('2025-1-1')).toBe(false);
    expect(isValidCalendarDate('not-a-date')).toBe(false);
  });
});
