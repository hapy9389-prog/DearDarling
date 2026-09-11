import { describe, expect, it } from 'vitest';
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { createCognitoAuthPort } from '../../src/cognito/cognitoAuthPort';
import { AuthPortRejectedError, AuthPortTimeoutError } from '../../src/cognito/authPort';
import type { CognitoConfig } from '../../src/cognito/client';

const CONFIG: CognitoConfig = {
  region: 'ap-northeast-2',
  userPoolId: 'ap-northeast-2_ABC123DEF',
  clientId: 'client',
  clientSecret: 'secret',
};

/** 실제 AWS 호출 없이 `client.send`가 특정 오류를 던지는 것만 흉내 낸다 — 분류 로직만 검증한다. */
function fakeClientThrowing(err: unknown): CognitoIdentityProviderClient {
  return { send: async () => Promise.reject(err) } as unknown as CognitoIdentityProviderClient;
}

describe('cognitoAuthPort error classification (real adapter, no AWS network calls)', () => {
  it.each([
    'CodeMismatchException',
    'ExpiredCodeException',
    'UserNotFoundException',
    'NotAuthorizedException',
    'UserNotConfirmedException',
    'InvalidPasswordException',
    'InvalidParameterException',
    'UsernameExistsException',
  ])('classifies %s as a definitive rejection', async (name) => {
    const err = Object.assign(new Error('cognito says no'), { name });
    const port = createCognitoAuthPort(fakeClientThrowing(err), CONFIG);
    await expect(
      port.confirmForgotPassword('a@example.com', '000000', 'NewPassw0rd1!'),
    ).rejects.toBeInstanceOf(AuthPortRejectedError);
  });

  it.each([
    'InternalErrorException',
    'TooManyRequestsException',
    'ServiceUnavailable',
    'ThrottlingException',
  ])('classifies %s as an undetermined result, not a rejection', async (name) => {
    const err = Object.assign(new Error('cognito had an issue'), { name });
    const port = createCognitoAuthPort(fakeClientThrowing(err), CONFIG);
    await expect(
      port.confirmForgotPassword('a@example.com', '000000', 'NewPassw0rd1!'),
    ).rejects.toBeInstanceOf(AuthPortTimeoutError);
  });

  it('classifies a raw network error (ECONNRESET-style, no recognizable exception name) as undetermined', async () => {
    // 실제 Node 네트워크 오류는 보통 name이 'Error'이고 code만 'ECONNRESET'이다 — name만으로
    // 판단하므로 이런 오류가 허용 목록에 없는 한 "확정 거절"로 잘못 분류되지 않아야 한다.
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const port = createCognitoAuthPort(fakeClientThrowing(err), CONFIG);
    await expect(
      port.confirmForgotPassword('a@example.com', '000000', 'NewPassw0rd1!'),
    ).rejects.toBeInstanceOf(AuthPortTimeoutError);
  });

  it('classifies a completely unknown exception name as undetermined (safe default)', async () => {
    const err = Object.assign(new Error('never seen this before'), {
      name: 'SomeFutureCognitoException',
    });
    const port = createCognitoAuthPort(fakeClientThrowing(err), CONFIG);
    await expect(
      port.confirmForgotPassword('a@example.com', '000000', 'NewPassw0rd1!'),
    ).rejects.toBeInstanceOf(AuthPortTimeoutError);
  });

  it('applies the same classification rule to initiateAuth (login)', async () => {
    const definitively = Object.assign(new Error('bad password'), {
      name: 'NotAuthorizedException',
    });
    const ambiguous = Object.assign(new Error('internal'), { name: 'InternalErrorException' });
    await expect(
      createCognitoAuthPort(fakeClientThrowing(definitively), CONFIG).initiateAuth(
        'a@example.com',
        'pw',
      ),
    ).rejects.toBeInstanceOf(AuthPortRejectedError);
    await expect(
      createCognitoAuthPort(fakeClientThrowing(ambiguous), CONFIG).initiateAuth(
        'a@example.com',
        'pw',
      ),
    ).rejects.toBeInstanceOf(AuthPortTimeoutError);
  });
});
