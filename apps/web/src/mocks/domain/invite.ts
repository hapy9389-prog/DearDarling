import type { Invite } from '../types';

/** Crockford base32에서 헷갈리는 글자(I·L·O·U) 제외. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BODY_LENGTH = 6;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72시간
export const INVITE_CODE_RE = /^DD-[0-9A-HJKMNP-TV-Z]{6}$/;

export function generateCode(): string {
  let body = '';
  for (let i = 0; i < CODE_BODY_LENGTH; i += 1) {
    body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `DD-${body}`;
}

/** 사용자가 입력한 코드를 표준형(대문자, 'DD-' 접두, 공백·구분자 제거)으로 정규화한다. */
export function normalizeCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/\s/g, '').replace(/^DD-?/, '').replace(/-/g, '');
  return `DD-${cleaned}`;
}

export function isExpired(invite: Invite, now: Date = new Date()): boolean {
  return new Date(invite.expiresAt).getTime() <= now.getTime();
}

export function deriveStatus(
  invite: Invite,
  now: Date = new Date(),
): 'pending' | 'expired' | 'accepted' | 'revoked' {
  if (invite.status === 'accepted') return 'accepted';
  if (invite.status === 'revoked') return 'revoked';
  return isExpired(invite, now) ? 'expired' : 'pending';
}
