/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 127.0.0.1로 고정한다 — apps/api의 세션 쿠키(Secure)가 신뢰하는 루프백 주소와 맞춰야
    // 하고, apps/api/.env의 ALLOWED_ORIGIN도 이 주소와 정확히 같은 문자열이어야 한다.
    host: '127.0.0.1',
    port: 5173,
    // 포트가 이미 쓰이는 중이면 다른 포트로 조용히 옮기지 않는다 — 그러면 ALLOWED_ORIGIN과
    // 어긋나 모든 상태 변경 요청이 원인을 알기 어렵게 403으로 막힌다.
    strictPort: true,
    proxy: {
      // 브라우저 입장에서 동일 출처 요청이 되게 한다 — apps/api에 CORS 설정이 없어도 되고,
      // Origin 헤더는 그대로 웹 개발 서버 주소로 전달돼 originCheck와도 맞는다.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: true,
  },
});
