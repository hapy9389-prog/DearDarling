import { describe, expect, it } from 'vitest';
import {
  assertTestAuthNotEnabledInProduction,
  assertCognitoConfiguredInProduction,
  assertTokenEncryptionConfiguredInProduction,
  loadEnv,
} from '../../src/config/env';

describe('assertTestAuthNotEnabledInProduction', () => {
  it('throws when LOCAL_TEST_AUTH is enabled in production', () => {
    expect(() =>
      assertTestAuthNotEnabledInProduction({ nodeEnv: 'production', localTestAuth: true }),
    ).toThrow();
  });

  it('allows test auth outside production', () => {
    expect(() =>
      assertTestAuthNotEnabledInProduction({ nodeEnv: 'development', localTestAuth: true }),
    ).not.toThrow();
  });

  it('allows production when test auth is disabled', () => {
    expect(() =>
      assertTestAuthNotEnabledInProduction({ nodeEnv: 'production', localTestAuth: false }),
    ).not.toThrow();
  });
});

describe('assertCognitoConfiguredInProduction', () => {
  it('throws when Cognito config is missing in production', () => {
    expect(() => assertCognitoConfiguredInProduction({ nodeEnv: 'production' })).toThrow();
  });

  it('allows missing Cognito config outside production', () => {
    expect(() => assertCognitoConfiguredInProduction({ nodeEnv: 'development' })).not.toThrow();
  });

  it('allows production when Cognito config is present', () => {
    expect(() =>
      assertCognitoConfiguredInProduction({
        nodeEnv: 'production',
        cognito: { region: 'ap-northeast-2', userPoolId: 'x', clientId: 'y', clientSecret: 'z' },
      }),
    ).not.toThrow();
  });
});

describe('assertTokenEncryptionConfiguredInProduction', () => {
  it('throws when the token encryption key is missing in production', () => {
    expect(() => assertTokenEncryptionConfiguredInProduction({ nodeEnv: 'production' })).toThrow();
  });

  it('allows a missing key outside production', () => {
    expect(() =>
      assertTokenEncryptionConfiguredInProduction({ nodeEnv: 'development' }),
    ).not.toThrow();
  });

  it('allows production when the key is present', () => {
    expect(() =>
      assertTokenEncryptionConfiguredInProduction({
        nodeEnv: 'production',
        tokenEncryptionKey: Buffer.alloc(32),
      }),
    ).not.toThrow();
  });
});

describe('loadEnv', () => {
  const base = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
    ALLOWED_ORIGIN: 'http://127.0.0.1:3000',
  };

  it('throws when ALLOWED_ORIGIN is missing — no guessed default', () => {
    const withoutOrigin: Record<string, string> = { ...base };
    delete withoutOrigin.ALLOWED_ORIGIN;
    expect(() => loadEnv(withoutOrigin)).toThrow(/ALLOWED_ORIGIN/);
  });

  it('leaves cognito undefined when only some COGNITO_* vars are set', () => {
    const env = loadEnv({
      ...base,
      COGNITO_REGION: 'ap-northeast-2',
      COGNITO_USER_POOL_ID: 'pool',
    });
    expect(env.cognito).toBeUndefined();
  });

  it('populates cognito only when all four vars are set', () => {
    const env = loadEnv({
      ...base,
      COGNITO_REGION: 'ap-northeast-2',
      COGNITO_USER_POOL_ID: 'pool',
      COGNITO_CLIENT_ID: 'client',
      COGNITO_CLIENT_SECRET: 'secret',
    });
    expect(env.cognito).toEqual({
      region: 'ap-northeast-2',
      userPoolId: 'pool',
      clientId: 'client',
      clientSecret: 'secret',
    });
  });

  it('leaves tokenEncryptionKey undefined when unset', () => {
    const env = loadEnv(base);
    expect(env.tokenEncryptionKey).toBeUndefined();
  });

  it('parses a valid base64-encoded 32-byte SESSION_TOKEN_ENCRYPTION_KEY', () => {
    const key = Buffer.alloc(32, 7);
    const env = loadEnv({ ...base, SESSION_TOKEN_ENCRYPTION_KEY: key.toString('base64') });
    expect(env.tokenEncryptionKey).toEqual(key);
  });

  it('throws (without echoing the value) when the key is the wrong length', () => {
    const wrongLength = Buffer.alloc(16).toString('base64');
    expect(() => loadEnv({ ...base, SESSION_TOKEN_ENCRYPTION_KEY: wrongLength })).toThrow(
      /32바이트/,
    );
    try {
      loadEnv({ ...base, SESSION_TOKEN_ENCRYPTION_KEY: wrongLength });
    } catch (err) {
      expect((err as Error).message).not.toContain(wrongLength);
    }
  });
});
