import type { Request, Response } from 'express';

const COOKIE_NAME = 'dd_session';
const COOKIE_PATH = '/';

/** HttpOnly·Secure·SameSite=Strict·Path·만료를 전부 명시한다 — 하나라도 빠지면 취약점이 된다. */
export function setSessionCookie(res: Response, sessionId: string, expiresAt: Date): void {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

/** 로그아웃 시 발급 때와 같은 속성(특히 path)으로 지운다 — 다르면 브라우저가 지우지 못한다. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
}

export function readSessionCookie(req: Request): string | undefined {
  return req.cookies?.[COOKIE_NAME];
}
