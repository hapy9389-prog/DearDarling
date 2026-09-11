import { TOKEN_ENCRYPTION_KEY_BYTES } from '../cognito/tokenCipher';

export interface CognitoEnvConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret: string;
}

export interface AppEnv {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  localTestAuth: boolean;
  allowedOrigin: string;
  /** 넷 다 설정됐을 때만 채워진다 — 아직 실제 User Pool을 만들지 않은 로컬 개발에서는 없을 수 있다. */
  cognito?: CognitoEnvConfig;
  /** refresh token을 sessions 테이블에 암호화해 저장하는 데 쓰는 AES-256-GCM 키(32바이트). */
  tokenEncryptionKey?: Buffer;
}

/**
 * 배포 환경에서 테스트 헤더 인증(X-Test-User-Id)이 절대 켜질 수 없도록 막는 안전장치.
 * server.ts 기동 시 반드시 이 함수를 거친다 — 통과하지 못하면 서버가 아예 뜨지 않는다.
 */
export function assertTestAuthNotEnabledInProduction(env: {
  nodeEnv: string;
  localTestAuth: boolean;
}): void {
  if (env.nodeEnv === 'production' && env.localTestAuth) {
    throw new Error(
      'LOCAL_TEST_AUTH=true는 NODE_ENV=production에서 켤 수 없습니다. ' +
        '배포 환경에서 테스트 헤더로 인증이 대체되는 것을 막기 위한 안전장치입니다.',
    );
  }
}

/** 배포 환경에서 Cognito 설정 없이(=인증 없이) 뜨는 것을 막는다. */
export function assertCognitoConfiguredInProduction(env: {
  nodeEnv: string;
  cognito?: CognitoEnvConfig;
}): void {
  if (env.nodeEnv === 'production' && !env.cognito) {
    throw new Error(
      'NODE_ENV=production에서는 COGNITO_REGION/COGNITO_USER_POOL_ID/COGNITO_CLIENT_ID/' +
        'COGNITO_CLIENT_SECRET이 모두 설정돼 있어야 합니다.',
    );
  }
}

function loadCognitoConfig(source: NodeJS.ProcessEnv): CognitoEnvConfig | undefined {
  const region = source.COGNITO_REGION;
  const userPoolId = source.COGNITO_USER_POOL_ID;
  const clientId = source.COGNITO_CLIENT_ID;
  const clientSecret = source.COGNITO_CLIENT_SECRET;
  if (!region || !userPoolId || !clientId || !clientSecret) return undefined;
  return { region, userPoolId, clientId, clientSecret };
}

/** 배포 환경에서 토큰 암호화 키 없이(=refresh token을 저장할 수 없이) 뜨는 것을 막는다. */
export function assertTokenEncryptionConfiguredInProduction(env: {
  nodeEnv: string;
  tokenEncryptionKey?: Buffer;
}): void {
  if (env.nodeEnv === 'production' && !env.tokenEncryptionKey) {
    throw new Error(
      `NODE_ENV=production에서는 SESSION_TOKEN_ENCRYPTION_KEY(base64로 인코딩된 ` +
        `${TOKEN_ENCRYPTION_KEY_BYTES}바이트 값)가 설정돼 있어야 합니다.`,
    );
  }
}

function loadTokenEncryptionKey(source: NodeJS.ProcessEnv): Buffer | undefined {
  const raw = source.SESSION_TOKEN_ENCRYPTION_KEY;
  if (!raw) return undefined;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== TOKEN_ENCRYPTION_KEY_BYTES) {
    // 값 자체는(설령 형식이 틀렸어도) 오류 메시지에 담지 않는다 — 길이만 언급한다.
    throw new Error(
      `SESSION_TOKEN_ENCRYPTION_KEY는 base64로 인코딩된 ${TOKEN_ENCRYPTION_KEY_BYTES}바이트 값이어야 합니다.`,
    );
  }
  return key;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const nodeEnv = source.NODE_ENV ?? 'development';
  const localTestAuth = source.LOCAL_TEST_AUTH === 'true';
  assertTestAuthNotEnabledInProduction({ nodeEnv, localTestAuth });

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 환경변수가 필요합니다 (.env.example 참고).');

  const port = Number(source.PORT ?? 3000);
  const allowedOrigin = source.ALLOWED_ORIGIN;
  if (!allowedOrigin) {
    throw new Error(
      'ALLOWED_ORIGIN 환경변수가 필요합니다 — 상태를 바꾸는 요청의 Origin 검사 기준이라 ' +
        '기본값으로 추측하지 않는다(.env.example 참고).',
    );
  }

  const cognito = loadCognitoConfig(source);
  assertCognitoConfiguredInProduction({ nodeEnv, cognito });

  const tokenEncryptionKey = loadTokenEncryptionKey(source);
  assertTokenEncryptionConfiguredInProduction({ nodeEnv, tokenEncryptionKey });

  return { nodeEnv, port, databaseUrl, localTestAuth, allowedOrigin, cognito, tokenEncryptionKey };
}
