/**
 * apps/web/src/mocks/domain/invite.ts의 규칙을 그대로 이식한다(72시간 TTL,
 * 헷갈리는 글자(I·L·O·U)를 뺀 Crockford base32 코드). 실제 만료·중복수락 방지는
 * DB 트랜잭션으로 처리하므로(src/services/inviteService.ts) 여기는 순수 함수만 둔다.
 */

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BODY_LENGTH = 6;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
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
