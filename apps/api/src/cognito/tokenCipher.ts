import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
export const TOKEN_ENCRYPTION_KEY_BYTES = 32; // AES-256

/** 잘못된 복호화 시도(키 불일치·손상된 값 등) — 절대 "완료"로 처리하면 안 되는 신호다. */
export class TokenDecryptionError extends Error {
  constructor() {
    // 원인이 된 원본 오류·키·암호문은 메시지에 절대 포함하지 않는다 — 로그로 새 나가지 않게 한다.
    super('token-decryption-failed');
    this.name = 'TokenDecryptionError';
  }
}

/** refresh token 같은 민감한 문자열을 세션 테이블에 저장하기 전 암호화한다(AES-256-GCM). */
export function encryptToken(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * 키가 없거나 틀렸거나, 저장된 값이 손상됐으면 `TokenDecryptionError`를 던진다 — 호출부는 이걸
 * "완료"로 착각해선 안 된다(정리 루틴이 그대로 재시도 대상에 남겨 둬야 한다).
 */
export function decryptToken(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length < IV_LENGTH + AUTH_TAG_LENGTH) throw new TokenDecryptionError();
  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // node:crypto의 원본 오류(예: "Unsupported state or unable to authenticate data")는
    // 키·암호문 관련 세부 정보를 담을 수 있어 그대로 전달하지 않는다.
    throw new TokenDecryptionError();
  }
}
