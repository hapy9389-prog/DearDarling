import { describe, expect, it } from 'vitest';
import { isCoupleAnalysisActive } from '../../src/domain/consent';

describe('consent domain', () => {
  it('is active only when both partners consent', () => {
    expect(isCoupleAnalysisActive(true, true)).toBe(true);
    expect(isCoupleAnalysisActive(true, false)).toBe(false);
    expect(isCoupleAnalysisActive(false, true)).toBe(false);
    expect(isCoupleAnalysisActive(false, false)).toBe(false);
  });
});
