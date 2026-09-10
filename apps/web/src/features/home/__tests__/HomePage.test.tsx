import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../App';
import { resetAllMockData } from '../../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

async function openDevPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /검토 도구/ }));
}
async function closeDevPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
}

describe('홈 화면', () => {
  it('함께한 날짜를 일수로 보여준다', () => {
    render(<App />);
    expect(screen.getByText(/함께한 지 [\d,]+일/)).toBeInTheDocument();
  });

  it('오늘의 대화 요약은 가상 예시임을 표시한다', () => {
    render(<App />);
    expect(screen.getByText('예시')).toBeInTheDocument();
  });

  it('빈 대화 시나리오에서는 요약 대신 대화 시작 안내를 보여준다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openDevPanel(user);
    await user.click(screen.getByRole('button', { name: /빈 대화/ }));
    await closeDevPanel(user);

    expect(screen.getByText(/오늘은 아직 나눈 대화가 없어요/)).toBeInTheDocument();
    expect(screen.queryByText('예시')).not.toBeInTheDocument();
  });

  it('AI 분석을 철회하면 홈 요약과 리포트 안내가 중단 상태로 바뀐다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(screen.getByLabelText(/AI 분석 동의/));
    await user.click(screen.getByRole('button', { name: '홈으로' }));

    expect(screen.getAllByText(/AI 분석이 중단/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('예시')).not.toBeInTheDocument();
  });

  it('코칭 카드 표시만 끄면 홈 요약은 그대로다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(screen.getByLabelText(/코칭 카드 표시/));
    await user.click(screen.getByRole('button', { name: '홈으로' }));

    // 개인 표시 설정이므로 홈에는 영향 없음 — 예시 요약 유지.
    expect(screen.getByText('예시')).toBeInTheDocument();
  });

  it('리포트 미리보기를 누르면 우리 탭으로 이동한다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '이번 주 우리 리포트 보기' }));
    expect(screen.getByText('이번 주 눈에 띈 우리 모습')).toBeInTheDocument();
  });

  it('기본 상태에서 이번 주 대표 발견 제목을 미리 보여준다', () => {
    render(<App />);
    expect(
      screen.getByText(/이번 주 발견 · 무거운 대화를 한 번에 끝내지 않아요/),
    ).toBeInTheDocument();
  });

  it('AI 준비 중·장애·발견 없음을 서로 다른 미리보기로 구분한다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openDevPanel(user);
    await user.click(screen.getByRole('button', { name: /AI 준비 중/ }));
    await closeDevPanel(user);
    expect(screen.getByText(/오늘 대화를 살펴보고 있어요/)).toBeInTheDocument();
    expect(screen.getByText(/이번 주 리포트를 준비하고 있어요/)).toBeInTheDocument();

    await openDevPanel(user);
    await user.click(screen.getByRole('button', { name: /AI 장애/ }));
    await closeDevPanel(user);
    expect(screen.getByText(/지금은 오늘 요약을 불러올 수 없어요/)).toBeInTheDocument();
    expect(screen.getByText(/지금은 리포트를 불러올 수 없어요/)).toBeInTheDocument();

    await openDevPanel(user);
    await user.click(screen.getByRole('button', { name: /^정상/ }));
    await user.click(screen.getByRole('button', { name: '이번 주 발견 없음' }));
    await closeDevPanel(user);
    expect(screen.getByText(/이번 주는 특별히 눈에 띈 흐름은 없었어요/)).toBeInTheDocument();
    expect(
      screen.queryByText(/이번 주 발견 · 무거운 대화를 한 번에 끝내지 않아요/),
    ).not.toBeInTheDocument();
  });
});
