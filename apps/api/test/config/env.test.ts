import { describe, expect, it } from 'vitest';
import { assertTestAuthNotEnabledInProduction } from '../../src/config/env';

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
