import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRouter } from '../app-router/AppRouter';
import { trialKey, writeJSON } from '../mocks/storage';
import type { SeededSession } from './seed';

const SESSION_KEY = trialKey('session');

export interface RenderAppOptions {
  /** 시작 URL. 기본은 홈. */
  route?: string;
  /**
   * 시작 세션. 생략하면 익명(시작 화면). 기존 통합 테스트는 `seedReviewSession()`을 넘긴다.
   * trial 세션은 먼저 `seed*` 헬퍼로 사용자를 심어 둔 뒤 그 id로 넘긴다.
   */
  session?: SeededSession;
}

/**
 * 통합 테스트용 앱 렌더러. `<App />` 대신 이걸 쓴다 —
 * `<MemoryRouter>`로 테스트마다 히스토리를 격리하고, 원하는 경로·세션에서 시작한다.
 */
export function renderApp({ route = '/app/home', session }: RenderAppOptions = {}): RenderResult {
  if (session) writeJSON(SESSION_KEY, session);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppRouter />
    </MemoryRouter>,
  );
}
