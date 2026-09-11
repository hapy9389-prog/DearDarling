import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15000,
    // 동시성 테스트가 같은 테이블을 건드리므로 파일 간 병렬 실행을 끈다.
    fileParallelism: false,
  },
});
