import { describe, expect, it } from 'vitest';
import { generateCode, normalizeCode, INVITE_CODE_RE } from '../../src/domain/invite';

describe('invite domain', () => {
  it('generates codes matching the DD-XXXXXX format', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateCode()).toMatch(INVITE_CODE_RE);
    }
  });

  it('normalizes user input into the standard code format', () => {
    expect(normalizeCode('dd-ab12cd')).toBe('DD-AB12CD');
    expect(normalizeCode('AB12CD')).toBe('DD-AB12CD');
    expect(normalizeCode(' dd ab12cd ')).toBe('DD-AB12CD');
  });
});
