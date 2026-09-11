import { randomUUID } from 'node:crypto';
import {
  AuthPortRejectedError,
  AuthPortTimeoutError,
  type CognitoAuthPort,
  type IdTokenClaims,
  type InitiateAuthResult,
} from './authPort';

interface StubUser {
  sub: string;
  email: string;
  password: string;
  confirmed: boolean;
  signUpCode: string;
  resetCode: string | null;
}

export interface StubAuthPort extends CognitoAuthPort {
  /** 다음 한 번의 confirmForgotPassword 호출을 "응답 못 받음"(케이스 C)으로 만든다. */
  simulateForgotPasswordTimeoutOnce(email: string): void;
  /** 로컬 DB 저장 없이 Cognito 쪽 가입·확인만 끝난 사용자를 만든다(§3-3 재현용). */
  seedConfirmedUser(email: string, password: string): { sub: string };
  /** 그 refresh token으로의 다음 revokeToken 호출 한 번을 실패시킨다(정리 루틴 재시도 검증용). */
  simulateRevokeTokenFailureOnce(refreshToken: string): void;
  /** 테스트가 실제로 폐기됐는지 확인하기 위한 조회 — 토큰 값 자체를 로그로 남기지 않고 직접 비교한다. */
  wasTokenRevoked(refreshToken: string): boolean;
}

/**
 * 실제 Cognito 대신 테스트에서 쓰는 완전한 가짜 구현 — 네트워크 호출이 없고, 각 API가 실제
 * Cognito의 성공/실패 계약(가입 미확인 시 로그인 거부, 코드 불일치 시 거절 등)을 따른다.
 * authService.ts의 실제 코드 경로(트랜잭션·경합·복구 로직)를 그대로 타면서 Cognito 응답만
 * 결정적으로 재현하기 위한 것 — 서비스 로직 자체를 테스트가 대신 흉내 내지 않는다.
 */
export function createStubAuthPort(): StubAuthPort {
  const users = new Map<string, StubUser>();
  const forgotPasswordTimeoutOnce = new Set<string>();
  const revokeTokenFailureOnce = new Set<string>();
  const revokedTokens = new Set<string>();

  function getOrThrow(email: string): StubUser {
    const u = users.get(email);
    if (!u) throw new AuthPortRejectedError('user-not-found', 'UserNotFoundException');
    return u;
  }

  function encodeIdToken(u: StubUser): string {
    return Buffer.from(
      JSON.stringify({ sub: u.sub, email: u.email, email_verified: true }),
    ).toString('base64url');
  }

  return {
    async signUp(email, password) {
      const sub = randomUUID();
      users.set(email, {
        sub,
        email,
        password,
        confirmed: false,
        signUpCode: '111111',
        resetCode: null,
      });
      return { userConfirmed: false };
    },

    async confirmSignUp(email, code) {
      const u = getOrThrow(email);
      if (u.signUpCode !== code)
        throw new AuthPortRejectedError('invalid-code', 'CodeMismatchException');
      u.confirmed = true;
    },

    async resendConfirmationCode(email) {
      getOrThrow(email);
    },

    async initiateAuth(email, password): Promise<InitiateAuthResult> {
      const u = getOrThrow(email);
      if (!u.confirmed) {
        throw new AuthPortRejectedError('user-not-confirmed', 'UserNotConfirmedException');
      }
      if (u.password !== password) {
        throw new AuthPortRejectedError('invalid-credentials', 'NotAuthorizedException');
      }
      return {
        idToken: encodeIdToken(u),
        accessToken: `stub-access-${u.sub}`,
        refreshToken: `stub-refresh-${u.sub}`,
      };
    },

    async verifyIdToken(idToken): Promise<IdTokenClaims> {
      let claims: { sub?: unknown; email?: unknown; email_verified?: unknown };
      try {
        claims = JSON.parse(Buffer.from(idToken, 'base64url').toString('utf8'));
      } catch {
        throw new AuthPortRejectedError('invalid-id-token');
      }
      if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
        throw new AuthPortRejectedError('invalid-id-token');
      }
      return {
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
      };
    },

    async forgotPassword(email) {
      const u = getOrThrow(email);
      u.resetCode = '222222';
    },

    async confirmForgotPassword(email, code, newPassword) {
      if (forgotPasswordTimeoutOnce.has(email)) {
        forgotPasswordTimeoutOnce.delete(email);
        throw new AuthPortTimeoutError();
      }
      const u = getOrThrow(email);
      if (u.resetCode !== code)
        throw new AuthPortRejectedError('invalid-code', 'ExpiredCodeException');
      u.password = newPassword;
      u.resetCode = null;
    },

    async revokeToken(token) {
      if (revokeTokenFailureOnce.has(token)) {
        revokeTokenFailureOnce.delete(token);
        throw new Error('simulated revoke-token failure');
      }
      revokedTokens.add(token);
    },

    simulateForgotPasswordTimeoutOnce(email) {
      forgotPasswordTimeoutOnce.add(email);
    },

    seedConfirmedUser(email, password) {
      const sub = randomUUID();
      users.set(email, {
        sub,
        email,
        password,
        confirmed: true,
        signUpCode: '111111',
        resetCode: null,
      });
      return { sub };
    },

    simulateRevokeTokenFailureOnce(refreshToken) {
      revokeTokenFailureOnce.add(refreshToken);
    },

    wasTokenRevoked(refreshToken) {
      return revokedTokens.has(refreshToken);
    },
  };
}
