import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/renderApp';
import { seedReviewSession } from '../../../test/seed';
import { resetAllMockData } from '../../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  renderApp({ session: seedReviewSession() });
  await user.click(screen.getByRole('button', { name: '설정' }));
}

describe('설정 화면', () => {
  it('AI 분석 동의를 끄면 커플 분석이 "중단"으로 표시되고 대화 화면 코칭이 막힌다', async () => {
    const user = userEvent.setup();
    await openSettings(user);

    expect(screen.getByText(/현재 커플 분석: 활성/)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/AI 분석 동의/));
    expect(screen.getByText(/현재 커플 분석: 중단/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText('AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'),
    ).toBeInTheDocument();
  });

  it('코칭 카드 표시를 꺼도 커플 분석은 "활성"이고 대화 화면은 코칭 카드만 숨겨진다', async () => {
    const user = userEvent.setup();
    await openSettings(user);

    await user.click(screen.getByLabelText(/코칭 카드 표시/));
    expect(screen.getByText(/현재 커플 분석: 활성/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText('코칭 카드를 숨겨두었어요. 분석은 계속되고 있어요.'),
    ).toBeInTheDocument();
  });

  it('상대의 분석 동의 상태는 읽기 전용 텍스트로만 보인다', async () => {
    const user = userEvent.setup();
    await openSettings(user);

    expect(screen.getByText(/서연님: 동의함/)).toBeInTheDocument();
    expect(screen.getByText(/상대의 설정은 바꿀 수 없어요/)).toBeInTheDocument();

    // 내가 바꿀 수 있는(비활성 아님) 토글은 내 설정 3개 — AI 분석 동의·코칭 카드 표시·작성 중 표현 도움.
    const enabled = screen
      .getAllByRole('checkbox')
      .filter((c) => !(c as HTMLInputElement).disabled);
    expect(enabled).toHaveLength(3);
  });

  it('작성 중 표현 도움은 기본 꺼짐이고 개인 설정으로 켤 수 있다', async () => {
    const user = userEvent.setup();
    await openSettings(user);

    const draftHelp = screen.getByLabelText(/작성 중 표현 도움/) as HTMLInputElement;
    expect(draftHelp).not.toBeChecked();
    expect(draftHelp).not.toBeDisabled();
    expect(screen.queryByText('준비 중')).not.toBeInTheDocument();

    await user.click(draftHelp);
    expect(draftHelp).toBeChecked();
  });

  it('설정은 계정별로 분리된다 — 계정을 바꾸면 그 사람의 값이 보인다', async () => {
    const user = userEvent.setup();
    await openSettings(user);

    // 민준: AI 분석 동의 끄기
    await user.click(screen.getByLabelText(/AI 분석 동의/));
    expect(screen.getByLabelText(/AI 분석 동의/)).not.toBeChecked();

    // 검토 도구로 서연 계정 전환
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /서연/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    // 서연 설정은 건드린 적이 없으므로 기본값(동의) 유지 — 민준의 변경이 새어나가지 않는다.
    expect(screen.getByLabelText(/AI 분석 동의/)).toBeChecked();
    // 상대(민준) 상태가 '동의 안 함'으로 읽기 전용 표시되고, 커플 분석은 중단.
    expect(screen.getByText(/민준님: 동의 안 함/)).toBeInTheDocument();
    expect(screen.getByText(/현재 커플 분석: 중단/)).toBeInTheDocument();
  });
});
