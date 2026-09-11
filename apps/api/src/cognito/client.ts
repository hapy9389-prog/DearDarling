import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret: string;
}

export function createCognitoClient(region: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ region });
}
