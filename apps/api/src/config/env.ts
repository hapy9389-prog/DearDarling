export interface AppEnv {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  localTestAuth: boolean;
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

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const nodeEnv = source.NODE_ENV ?? 'development';
  const localTestAuth = source.LOCAL_TEST_AUTH === 'true';
  assertTestAuthNotEnabledInProduction({ nodeEnv, localTestAuth });

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 환경변수가 필요합니다 (.env.example 참고).');

  const port = Number(source.PORT ?? 3000);

  return { nodeEnv, port, databaseUrl, localTestAuth };
}
