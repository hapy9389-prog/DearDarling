import { createHmac } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  RevokeTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  AuthPortRejectedError,
  AuthPortTimeoutError,
  type CognitoAuthPort,
  type IdTokenClaims,
  type InitiateAuthResult,
} from './authPort';
import type { CognitoConfig } from './client';

/**
 * 실제 Cognito 호출 구현. 로컬 샌드박스에서는 실제 User Pool이 없어 한 번도 실행 검증되지
 * 않았다 — 계획 §A-3의 API별 인자 형태(어떤 API가 SecretHash를 쓰는지, GlobalSignOut/RevokeToken이
 * 서로 다른 인자를 받는다는 것 등)를 AWS 공식 문서 기준으로 반영했을 뿐, 실제 Pool을 만들어
 * 호출해 보기 전까지는 미검증이다(보고서 참고).
 */
export function createCognitoAuthPort(
  client: CognitoIdentityProviderClient,
  config: CognitoConfig,
): CognitoAuthPort {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    tokenUse: 'id',
    clientId: config.clientId,
  });

  function secretHash(username: string): string {
    return createHmac('sha256', config.clientSecret)
      .update(username + config.clientId)
      .digest('base64');
  }

  // Cognito가 요청 내용 자체를 명확하게 거절했다고 문서에 기술된 예외들만 "확정 거절"로 다룬다.
  // ECONNRESET류 네트워크 오류, InternalErrorException(Cognito 내부 오류), TooManyRequestsException,
  // 그 외 여기 없는 알 수 없는 이름은 전부 "결과를 확정할 수 없음"(unknown)으로 남긴다 — 요청이
  // 실제로는 처리됐지만 응답 전달만 실패했을 가능성을 배제할 수 없기 때문이다(기본값을 안전한
  // 쪽으로 둔다: 모르면 실패로 단정하지 않는다).
  const DEFINITIVE_REJECTION_ERROR_NAMES = new Set([
    'CodeMismatchException',
    'ExpiredCodeException',
    'UserNotFoundException',
    'NotAuthorizedException',
    'UserNotConfirmedException',
    'InvalidPasswordException',
    'InvalidParameterException',
    'UsernameExistsException',
    'AliasExistsException',
    'PasswordResetRequiredException',
    'CodeDeliveryFailureException',
  ]);

  function toPortError(err: unknown): Error {
    const name = (err as { name?: string })?.name;
    if (name && DEFINITIVE_REJECTION_ERROR_NAMES.has(name)) {
      return new AuthPortRejectedError((err as Error).message ?? 'cognito-rejected', name);
    }
    return new AuthPortTimeoutError((err as Error)?.message ?? 'cognito-result-unknown');
  }

  return {
    async signUp(email, password) {
      try {
        const result = await client.send(
          new SignUpCommand({
            ClientId: config.clientId,
            SecretHash: secretHash(email),
            Username: email,
            Password: password,
            UserAttributes: [{ Name: 'email', Value: email }],
          }),
        );
        return { userConfirmed: result.UserConfirmed ?? false };
      } catch (err) {
        throw toPortError(err);
      }
    },

    async confirmSignUp(email, code) {
      try {
        await client.send(
          new ConfirmSignUpCommand({
            ClientId: config.clientId,
            SecretHash: secretHash(email),
            Username: email,
            ConfirmationCode: code,
          }),
        );
      } catch (err) {
        throw toPortError(err);
      }
    },

    async resendConfirmationCode(email) {
      try {
        await client.send(
          new ResendConfirmationCodeCommand({
            ClientId: config.clientId,
            SecretHash: secretHash(email),
            Username: email,
          }),
        );
      } catch (err) {
        throw toPortError(err);
      }
    },

    async initiateAuth(email, password): Promise<InitiateAuthResult> {
      try {
        const result = await client.send(
          new InitiateAuthCommand({
            ClientId: config.clientId,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: {
              USERNAME: email,
              PASSWORD: password,
              SECRET_HASH: secretHash(email),
            },
          }),
        );
        const tokens = result.AuthenticationResult;
        if (!tokens?.IdToken || !tokens.AccessToken || !tokens.RefreshToken) {
          throw new AuthPortRejectedError('incomplete-auth-result');
        }
        return {
          idToken: tokens.IdToken,
          accessToken: tokens.AccessToken,
          refreshToken: tokens.RefreshToken,
        };
      } catch (err) {
        if (err instanceof AuthPortRejectedError) throw err;
        throw toPortError(err);
      }
    },

    async verifyIdToken(idToken): Promise<IdTokenClaims> {
      try {
        const payload = await verifier.verify(idToken);
        if (typeof payload.email !== 'string')
          throw new AuthPortRejectedError('id-token-missing-email');
        return {
          sub: payload.sub,
          email: payload.email,
          emailVerified: payload.email_verified === true,
        };
      } catch (err) {
        if (err instanceof AuthPortRejectedError) throw err;
        throw new AuthPortRejectedError((err as Error).message ?? 'id-token-verification-failed');
      }
    },

    async forgotPassword(email) {
      try {
        await client.send(
          new ForgotPasswordCommand({
            ClientId: config.clientId,
            SecretHash: secretHash(email),
            Username: email,
          }),
        );
      } catch (err) {
        throw toPortError(err);
      }
    },

    async confirmForgotPassword(email, code, newPassword) {
      try {
        await client.send(
          new ConfirmForgotPasswordCommand({
            ClientId: config.clientId,
            SecretHash: secretHash(email),
            Username: email,
            ConfirmationCode: code,
            Password: newPassword,
          }),
        );
      } catch (err) {
        throw toPortError(err);
      }
    },

    async revokeToken(refreshToken) {
      try {
        // RevokeToken은 계산된 SecretHash가 아니라 ClientSecret 원문을 받는다(계획 §A-3).
        await client.send(
          new RevokeTokenCommand({
            Token: refreshToken,
            ClientId: config.clientId,
            ClientSecret: config.clientSecret,
          }),
        );
      } catch (err) {
        throw toPortError(err);
      }
    },
  };
}
