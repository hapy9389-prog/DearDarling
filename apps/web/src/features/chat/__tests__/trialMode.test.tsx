import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/renderApp';
import { seedConnectedTrialCouple, seedReviewSession } from '../../../test/seed';
import { createMockSettingsService } from '../../../mocks/services/settingsService';
import { createMockChatService } from '../../../mocks/services/chatService';
import { coupleKey, readJSON, resetAllMockData, writeJSON } from '../../../mocks/storage';
import type { ChatMessage } from '../../../mocks/types';

afterEach(() => {
  resetAllMockData();
});

function savedMessage(coupleId: string, body: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    coupleId,
    senderId: 'x',
    body,
    createdAt: new Date().toISOString(),
    status: 'saved',
  };
}

describe('신규 체험 — AI 분석/코칭/리포트 미제공 안내', () => {
  it('민준·서연의 시드 대화·코칭이 체험 커플 화면에 나오지 않는다', async () => {
    const { a } = seedConnectedTrialCouple();
    renderApp({ route: '/app/chat', session: { kind: 'trial', userId: a.id } });

    expect(
      await screen.findByText(/이번 체험에서는 AI 코칭을 제공하지 않아요/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/요즘 좀 힘들었어/)).not.toBeInTheDocument();
  });

  it('양측 동의를 켜도 예시 코칭이 아니라 "미제공" 안내가 유지된다', async () => {
    const { a, b } = seedConnectedTrialCouple();
    const settings = createMockSettingsService();
    settings.updateSettings(a.id, { analysisConsent: true });
    settings.updateSettings(b.id, { analysisConsent: true });

    renderApp({ route: '/app/chat', session: { kind: 'trial', userId: a.id } });
    expect(
      await screen.findByText(/이번 체험에서는 AI 코칭을 제공하지 않아요/),
    ).toBeInTheDocument();
  });

  it('우리 탭: 대화가 없으면 시작 안내, 있으면 통계 + 분석 미제공 안내', async () => {
    const { a, coupleId } = seedConnectedTrialCouple();

    const view = renderApp({ route: '/app/week', session: { kind: 'trial', userId: a.id } });
    expect(
      await screen.findByText('대화를 시작하면 이번 주 통계가 여기에 쌓여요.'),
    ).toBeInTheDocument();
    view.unmount();

    writeJSON(coupleKey(coupleId, 'messages'), [
      savedMessage(coupleId, '안녕'),
      savedMessage(coupleId, '오늘 뭐 했어'),
    ]);
    renderApp({ route: '/app/week', session: { kind: 'trial', userId: a.id } });
    expect(
      await screen.findByText(/이번 체험에서는 AI 분석 결과.*제공하지 않아요/),
    ).toBeInTheDocument();
    expect(screen.getByText('2개')).toBeInTheDocument(); // 주고받은 메시지
  });

  it('홈: 체험 커플은 주간 리포트 미제공 문구를, 오늘 대화가 있으면 AI 요약 미제공 문구를 보여준다', async () => {
    const { a, coupleId } = seedConnectedTrialCouple();
    writeJSON(coupleKey(coupleId, 'messages'), [savedMessage(coupleId, '오늘 나눈 말')]);
    renderApp({ route: '/app/home', session: { kind: 'trial', userId: a.id } });
    expect(
      await screen.findByText(/이번 체험에서는 주간 리포트를 제공하지 않아요/),
    ).toBeInTheDocument();
    expect(screen.getByText(/이번 체험에서는 AI 요약을 제공하지 않아요/)).toBeInTheDocument();
  });
});

describe('커플·모드 전환 시 이전 대화 상태 제거 (회귀)', () => {
  it('체험 커플 → 예시 모드 전환 시 대화 탭에 체험 메시지가 남지 않는다', async () => {
    const user = userEvent.setup();
    const { a, coupleId } = seedConnectedTrialCouple();
    writeJSON(coupleKey(coupleId, 'messages'), [savedMessage(coupleId, '체험 커플 메시지')]);

    renderApp({ route: '/app/chat', session: { kind: 'trial', userId: a.id } });
    expect(await screen.findByText('체험 커플 메시지')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /리뷰 모드로 보기/ }));

    await user.click(await screen.findByRole('button', { name: '대화' }));
    expect(screen.queryByText('체험 커플 메시지')).not.toBeInTheDocument();
    expect(await screen.findByText(/요즘 좀 힘들었어/)).toBeInTheDocument();
  });

  it('예시 → 체험 왕복해도 각 커플의 대화만 보인다', async () => {
    const user = userEvent.setup();
    const { coupleId } = seedConnectedTrialCouple();
    writeJSON(coupleKey(coupleId, 'messages'), [savedMessage(coupleId, '체험 전용 메시지')]);

    renderApp({ route: '/app/chat', session: seedReviewSession() });
    expect(await screen.findByText(/요즘 좀 힘들었어/)).toBeInTheDocument();

    // 예시 → 체험(가온)
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: '가온' }));
    await user.click(await screen.findByRole('button', { name: '대화' }));
    expect(await screen.findByText('체험 전용 메시지')).toBeInTheDocument();
    expect(screen.queryByText(/요즘 좀 힘들었어/)).not.toBeInTheDocument();
  });
});

describe('저장된 새 메시지를 주간 통계에 반영 (회귀)', () => {
  it('대화 0건 → 전송 후 우리 탭 통계가 새로고침 없이 갱신된다', async () => {
    const user = userEvent.setup();
    const { a, coupleId } = seedConnectedTrialCouple();

    renderApp({ route: '/app/week', session: { kind: 'trial', userId: a.id } });
    expect(
      await screen.findByText('대화를 시작하면 이번 주 통계가 여기에 쌓여요.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '대화' }));
    await user.type(screen.getByLabelText('메시지 입력'), '첫 메시지');
    await user.click(screen.getByRole('button', { name: '전송' }));

    // 저장이 끝난(saved) 뒤에 '우리' 탭을 연다 — 사용자 재현과 동일.
    await waitFor(
      () => {
        const msgs = readJSON<ChatMessage[]>(coupleKey(coupleId, 'messages'), []);
        expect(msgs.some((m) => m.status === 'saved')).toBe(true);
      },
      { timeout: 2000 },
    );

    await user.click(screen.getByRole('button', { name: '우리' }));
    expect(await screen.findByText('1개')).toBeInTheDocument();
    expect(
      screen.queryByText('대화를 시작하면 이번 주 통계가 여기에 쌓여요.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/이번 체험에서는 AI 분석 결과.*제공하지 않아요/)).toBeInTheDocument();
  });
});

describe('검토 모드(민준·서연)는 그대로', () => {
  it('양측 동의 상태에서 예시 코칭 카드가 나온다', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/app/chat', session: seedReviewSession() });
    // happy-path 시드에서 코칭 제안이 준비된다.
    expect(await screen.findByRole('button', { name: '코칭 카드 펼치기' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '코칭 카드 펼치기' }));
    expect(screen.getByText(/AI 코칭/)).toBeInTheDocument();
  });
});

describe('로그아웃 — 세션 격리', () => {
  it('설정에서 로그아웃하면 시작 화면으로 가고, 재로그인 시 대화가 저장 상태로 보인다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { a, coupleId } = seedConnectedTrialCouple();
    // 이 커플이 이미 나눈 대화 한 건
    writeJSON(coupleKey(coupleId, 'messages'), [savedMessage(coupleId, '이미 보낸 말')]);
    const user = userEvent.setup();

    renderApp({ route: '/app/settings', session: { kind: 'trial', userId: a.id } });
    await user.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('button', { name: '함께 시작하기' })).toBeInTheDocument();

    // 저장된 대화는 그 커플 저장소에 그대로 (검토 커플엔 없음)
    const chat = createMockChatService({ scenario: 'happy-path' });
    expect(chat.listMessages(coupleId).map((m) => m.body)).toContain('이미 보낸 말');
    expect(chat.listMessages('couple-1').some((m) => m.body === '이미 보낸 말')).toBe(false);

    confirmSpy.mockRestore();
  });
});
