import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { resetAllMockData } from '../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

describe('4탭 내비게이션', () => {
  it('앱을 열면 홈이 보이고, 네 개 탭을 오갈 수 있다', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 기본 진입 = 홈
    expect(screen.getByText(/함께한 지 [\d,]+일/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '우리' }));
    expect(screen.getByText('이번 주 눈에 띈 우리 모습')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '추억' }));
    expect(screen.getByText('추억 화면 준비 중')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(screen.getByLabelText('메시지 입력')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '홈' }));
    expect(screen.getByText(/함께한 지 [\d,]+일/)).toBeInTheDocument();
  });

  it('홈 상단 설정 버튼으로 설정에 들어갔다가 홈으로 돌아온다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByLabelText(/AI 분석 동의/)).toBeInTheDocument();
    // 설정 화면에서는 어떤 하단 탭도 현재 페이지(aria-current)로 표시되지 않는다.
    expect(screen.queryByRole('button', { current: 'page' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '홈으로' }));
    expect(screen.getByText(/함께한 지 [\d,]+일/)).toBeInTheDocument();
  });

  it('대화 탭은 언마운트되지 않지만 다른 탭에서는 보이지 않는다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(screen.getByTestId('message-list')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '홈' }));
    // 여전히 DOM에는 있지만(마운트 유지) 화면에는 보이지 않는다.
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
    expect(screen.getByTestId('message-list')).not.toBeVisible();
    expect(screen.getByText(/함께한 지 [\d,]+일/)).toBeInTheDocument();
  });
});
