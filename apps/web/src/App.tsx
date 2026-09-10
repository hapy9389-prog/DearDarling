import { BrowserRouter } from 'react-router';
import { AppRouter } from './app-router/AppRouter';

/**
 * 화면 전환에 react-router를 쓴다(0010, 0003 §1의 "그때 도입한다"). 라우트 정의는 `AppRouter`에
 * 있고, 여기서는 `<BrowserRouter>`만 씌운다 — 테스트는 `<MemoryRouter>` + `<AppRouter />`를 쓴다.
 */
export function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  );
}
