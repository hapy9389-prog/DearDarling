import { describe, expect, it } from 'vitest';
import { deriveStatus, generateCode, INVITE_CODE_RE, isExpired, normalizeCode } from '../invite';
import type { Invite } from '../../types';

function invite(overrides: Partial<Invite> = {}): Invite {
  return {
    code: 'DD-ABCDEF',
    inviterUserId: 'trial-user-a',
    createdAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-09-04T00:00:00.000Z',
    status: 'pending',
    accepterUserId: null,
    ...overrides,
  };
}

describe('generateCode / normalizeCode', () => {
  it('DD- + 헷갈리지 않는 base32 6자', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateCode()).toMatch(INVITE_CODE_RE);
    }
  });
  it('입력 코드를 표준형으로 정규화한다', () => {
    expect(normalizeCode(' dd-abc def ')).toBe('DD-ABCDEF');
    expect(normalizeCode('ABCDEF')).toBe('DD-ABCDEF');
    expect(normalizeCode('dd-ab-cd-ef')).toBe('DD-ABCDEF');
  });
});

describe('isExpired / deriveStatus', () => {
  it('만료 경계', () => {
    const inv = invite({ expiresAt: '2026-09-04T00:00:00.000Z' });
    expect(isExpired(inv, new Date('2026-09-03T23:59:59.999Z'))).toBe(false);
    expect(isExpired(inv, new Date('2026-09-04T00:00:00.000Z'))).toBe(true);
  });
  it('accepted·revoked는 그대로, pending은 만료 여부로 판단', () => {
    const now = new Date('2026-09-05T00:00:00.000Z');
    expect(deriveStatus(invite({ status: 'accepted' }), now)).toBe('accepted');
    expect(deriveStatus(invite({ status: 'revoked' }), now)).toBe('revoked');
    expect(deriveStatus(invite(), now)).toBe('expired');
    expect(deriveStatus(invite(), new Date('2026-09-02T00:00:00.000Z'))).toBe('pending');
  });
});
