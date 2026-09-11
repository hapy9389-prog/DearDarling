/**
 * Cognito API를 감싸는 포트 — 실제 SDK 구현(cognitoAuthPort.ts)과 테스트용 스텁(stubAuthPort.ts)이
 * 이 인터페이스를 공유한다. authService.ts는 이 인터페이스만 알고, 어느 쪽이 실제로 꽂혔는지는
 * 모른다 — AWS 자원 없이도 서비스 로직 전체(경합·복구 포함)를 테스트할 수 있게 하기 위해서다.
 */

export interface IdTokenClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export interface InitiateAuthResult {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

/** Cognito가 명확하게 거절한 경우(잘못된 코드·비밀번호, 미확인 계정 등) — 재시도해도 의미가 없다. */
export class AuthPortRejectedError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AuthPortRejectedError';
  }
}

/** 응답을 받지 못함(타임아웃·연결 끊김 등) — 성공/실패를 알 수 없다. */
export class AuthPortTimeoutError extends Error {
  constructor(message = 'auth-port-timeout') {
    super(message);
    this.name = 'AuthPortTimeoutError';
  }
}

export interface CognitoAuthPort {
  signUp(email: string, password: string): Promise<{ userConfirmed: boolean }>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendConfirmationCode(email: string): Promise<void>;
  initiateAuth(email: string, password: string): Promise<InitiateAuthResult>;
  /** 서명·issuer·만료·token_use·클라이언트 일치를 검증한 뒤에만 클레임을 반환한다 — 디코딩만 하지 않는다. */
  verifyIdToken(idToken: string): Promise<IdTokenClaims>;
  forgotPassword(email: string): Promise<void>;
  confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void>;
  /**
   * 특정 세션 하나의 refresh token 계열만 폐기한다. 세션마다 로그인 시 발급된 refresh token을
   * 암호화해 저장해 두므로(services/authService.ts의 login), 로그아웃·재설정 뒤 정리 루틴
   * (jobs/cleanupPendingAuth.ts)이 그 세션들 각각에 이 호출을 반복한다. **보장 범위는 이 서버가
   * 저장·관리하는 대상 refresh token들 각각을 개별 폐기하는 것뿐이다** — access token을 별도로
   * 보관하지 않으므로 GlobalSignOut(그 access token이 속한 사용자의 모든 토큰을 한 번에 폐기)은
   * 쓰지 않는다. access token은 발급 즉시 버려지며 세션에 저장되지 않는다. 접근 차단 자체(우리
   * 세션 쿠키 기준)는 이 폐기가 실제로 끝났는지와 무관하게 auth_version 비교로 이미 보장된다 —
   * 이건 Cognito 쪽 위생 정리일 뿐이다.
   */
  revokeToken(refreshToken: string): Promise<void>;
}
