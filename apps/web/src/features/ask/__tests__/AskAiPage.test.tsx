import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../App';
import { resetAllMockData } from '../../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

type User = ReturnType<typeof userEvent.setup>;

const Q1 = '요즘 대화가 겉도는 느낌이에요. 어떻게 시작하면 좋을까요?';
const A1_FRAGMENT = /오늘 있었던 일 하나를 구체적으로 나누는 것으로 시작/;

async function openAsk(): Promise<User> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '우리' }));
  await user.click(screen.getByRole('button', { name: /AI에게 물어보기/ }));
  return user;
}

async function switchAccount(user: User, name: RegExp) {
  await user.click(screen.getByRole('button', { name: /검토 도구/ }));
  await user.click(screen.getByRole('button', { name }));
  await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
}

describe('AI에게 물어보기 (개인 상담)', () => {
  it('우리 탭에서 진입하고 뒤로 나올 수 있으며, 하단 탭은 현재 페이지로 표시되지 않는다', async () => {
    const user = await openAsk();

    expect(screen.getByText('화면 검토용 예시이며 실제 AI 답변이 아닙니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { current: 'page' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '우리 탭으로' }));
    expect(screen.getByText('이번 주 눈에 띈 우리 모습')).toBeInTheDocument();
  });

  it('공유 리포트와 개인 상담을 구분하고, 자동 공개하지 않는다고 안내한다', async () => {
    await openAsk();

    expect(screen.getByText('공유 리포트와 개인 상담')).toBeInTheDocument();
    expect(screen.getByText(/공유 리포트에 자동으로 올라가지 않아요/)).toBeInTheDocument();
  });

  it('자유 입력창은 비활성이고 이후 단계 안내가 붙는다', async () => {
    await openAsk();

    expect(screen.getByLabelText('상담 입력')).toBeDisabled();
    expect(
      screen.getByText(/실제 대화를 분석하는 상담과 그 동의 방식은 이후 단계/),
    ).toBeInTheDocument();
  });

  it('예시 질문을 누르면 내 말풍선과 예시 답변이 대화형으로 표시된다', async () => {
    const user = await openAsk();

    await user.click(screen.getByRole('button', { name: Q1 }));

    // 내 질문이 말풍선으로 남고
    expect(screen.getByText(Q1)).toBeInTheDocument();
    // 예시 답변이 도착한다
    expect(await screen.findByText(A1_FRAGMENT, undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it('계정을 전환하면 이전 상담 내역이 초기화된다', async () => {
    const user = await openAsk();

    await user.click(screen.getByRole('button', { name: Q1 }));
    await screen.findByText(A1_FRAGMENT, undefined, { timeout: 2000 });

    await switchAccount(user, /서연/);

    // 서연 화면에는 민준이 나눈 상담이 남아 있지 않다.
    expect(screen.queryByText(A1_FRAGMENT)).not.toBeInTheDocument();
    // 질문은 다시 예시 목록의 버튼으로 돌아와 있다.
    expect(screen.getByRole('button', { name: Q1 })).toBeInTheDocument();
  });

  it('답변 대기 중에 계정을 전환하면 이전 계정의 늦은 답변이 새 화면에 나타나지 않는다', async () => {
    const user = await openAsk();

    await user.click(screen.getByRole('button', { name: Q1 }));
    // 답변(600ms)이 도착하기 전에 계정을 전환한다.
    await switchAccount(user, /서연/);

    // 이전 요청이 끝날 시간이 지나도 늦은 답변이 섞이면 안 된다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    expect(screen.queryByText(A1_FRAGMENT)).not.toBeInTheDocument();
    expect(screen.queryByText(Q1, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('타이머 제어: 답변 대기 중 민준→서연→민준으로 돌아와도 이전 답변과 완료 처리를 폐기한다', async () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: '우리' }));
      fireEvent.click(screen.getByRole('button', { name: /AI에게 물어보기/ }));

      // 민준 세션에서 예시 질문을 보낸다(답변은 600ms 뒤).
      fireEvent.click(screen.getByRole('button', { name: Q1 }));
      expect(screen.getByText('예시 답변을 불러오고 있어요…')).toBeInTheDocument();

      // 답변이 오기 전에 서연으로 전환한다(세션 1).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      fireEvent.click(screen.getByRole('button', { name: /검토 도구/ }));
      fireEvent.click(screen.getByRole('button', { name: /서연/ }));
      fireEvent.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

      // 다시 민준으로 돌아온다(계정 ID는 같지만 세션은 2로, 상담이 두 번 초기화됐다).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      fireEvent.click(screen.getByRole('button', { name: /검토 도구/ }));
      fireEvent.click(screen.getByRole('button', { name: /민준/ }));
      fireEvent.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

      // 원래 요청(600ms)이 완료될 시간이 지난다.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // 이전 세션의 늦은 답변도, 완료(대기 해제) 처리도 새 화면에 반영되지 않는다.
      expect(screen.queryByText(A1_FRAGMENT)).not.toBeInTheDocument();
      expect(screen.queryByText('예시 답변을 불러오고 있어요…')).not.toBeInTheDocument();
      expect(screen.queryByText(Q1, { selector: 'p' })).not.toBeInTheDocument();
      // 예시 질문은 다시 눌러볼 수 있는 상태다.
      expect(screen.getByRole('button', { name: Q1 })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
