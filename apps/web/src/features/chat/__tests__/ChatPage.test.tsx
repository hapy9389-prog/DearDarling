import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/renderApp';
import { seedReviewSession } from '../../../test/seed';
import { resetAllMockData } from '../../../mocks/storage';
import { SEED_DRAFT_HELP_EXAMPLES } from '../../../mocks/fixtures/draftHelp';

afterEach(() => {
  resetAllMockData();
});

const SUGGESTION_TEXT = '혹시 무슨 일 있었어? 얘기하고 싶으면 들어줄게';

/**
 * 홈이 기본 진입 화면이 됐으므로(0003), 대화 화면을 검토하는 테스트는 먼저 '대화' 탭으로 이동한다.
 */
async function renderChatScreen() {
  const user = userEvent.setup();
  renderApp({ session: seedReviewSession() });
  await user.click(screen.getByRole('button', { name: '대화' }));
  return user;
}

/**
 * 대화 화면엔 설정 진입점이 없으므로(설정은 홈 상단 ⚙️): 홈 탭 → ⚙️ → 토글 → 대화 탭.
 */
async function toggleSettingThenGoChat(
  user: ReturnType<typeof userEvent.setup>,
  toggleLabel: RegExp,
) {
  await user.click(screen.getByRole('button', { name: '홈' }));
  await user.click(screen.getByRole('button', { name: '설정' }));
  await user.click(screen.getByLabelText(toggleLabel));
  await user.click(screen.getByRole('button', { name: '대화' }));
}

describe('대화 화면 핵심 동작', () => {
  it('접힌 코칭 카드는 빈 안내가 아니라 실제 코칭 요점 한 줄을 보여준다', async () => {
    const user = await renderChatScreen();

    const collapsed = await screen.findByRole(
      'button',
      { name: '코칭 카드 펼치기' },
      { timeout: 2000 },
    );
    // 민준 시점의 코칭 요점(headline)이 접힌 상태에서 그대로 보인다.
    expect(
      within(collapsed).getByText('먼저 무슨 일이 있었는지 물어보면 좋아요.'),
    ).toBeInTheDocument();

    // 펼치면 근거와 추천 답장이 나온다.
    await user.click(collapsed);
    expect(await screen.findByText(/근거:/)).toBeInTheDocument();
    expect(screen.getByText(SUGGESTION_TEXT)).toBeInTheDocument();
  });

  it('추천 답장은 초안에만 채워지고, 전송 버튼을 눌러야 실제로 전송된다', async () => {
    const user = await renderChatScreen();

    const chip = await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });
    await user.click(chip);

    const suggestionButton = await screen.findByText(SUGGESTION_TEXT);
    await user.click(suggestionButton);

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    expect(input.value).toBe(SUGGESTION_TEXT);

    const messageList = screen.getByTestId('message-list');
    // 초안에 채워졌을 뿐 아직 전송 버튼을 누르지 않았으므로 대화 목록에는 나타나지 않아야 한다.
    expect(within(messageList).queryByText(SUGGESTION_TEXT)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '전송' }));

    await waitFor(
      () => {
        expect(within(messageList).getByText(SUGGESTION_TEXT)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    // 전송 후 입력창은 비워진다(자동으로 다시 채워지거나 재전송되지 않음).
    expect(input.value).toBe('');
  });

  it('분석 철회와 코칭 숨기기는 서로 다른 화면 상태를 보여준다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 설정 화면에서 AI 분석 동의 끄기(철회)
    await toggleSettingThenGoChat(user, /AI 분석 동의/);
    expect(
      await screen.findByText('AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'),
    ).toBeInTheDocument();

    // 다시 동의(원상 복구)
    await toggleSettingThenGoChat(user, /AI 분석 동의/);
    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 코칭 카드 표시만 끄기 — 분석은 계속되고 코칭 카드만 숨겨진다
    await toggleSettingThenGoChat(user, /코칭 카드 표시/);
    expect(
      await screen.findByText('코칭 카드를 숨겨두었어요. 분석은 계속되고 있어요.'),
    ).toBeInTheDocument();
    // 분석 철회 때 나온 문구와는 분명히 다른 문구여야 한다.
    expect(
      screen.queryByText('AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'),
    ).not.toBeInTheDocument();
  });

  it('AI 준비 중 시나리오여도 분석을 철회하면 분석 중단 안내가 먼저 보인다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 시나리오는 검토 도구로, 분석 철회는 설정 화면으로
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /AI 준비 중/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    await toggleSettingThenGoChat(user, /AI 분석 동의/); // 철회

    // 분석 동의·철회가 AI 준비 상태보다 우선이어야 한다.
    expect(
      await screen.findByText('AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('AI가 아직 대화를 살펴보고 있어요. 잠시 후 다시 확인해 주세요.'),
    ).not.toBeInTheDocument();
  });

  it('전송 중이거나 실패한 메시지는 보낸 사람에게만 보이고, 상대방에게는 저장 완료된 메시지만 보인다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 연결이 끊긴 시나리오로 바꿔 전송이 '전송 중 → 실패'로 남게 한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '테스트 메시지');
    await user.click(screen.getByRole('button', { name: '전송' }));

    // 보낸 사람(민준)에게는 전송 중 상태로 즉시 보인다.
    expect(
      within(screen.getByTestId('message-list')).getByText('테스트 메시지'),
    ).toBeInTheDocument();

    // 서연 계정으로 전환하면, 아직 저장 완료되지 않은 이 메시지는 보이지 않아야 한다
    // (전송 중이든, 잠시 후 실패로 확정되든 상대방에게는 애초에 보이면 안 된다).
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /서연/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    await waitFor(() => {
      expect(
        within(screen.getByTestId('message-list')).queryByText('테스트 메시지'),
      ).not.toBeInTheDocument();
    });
  });

  it('일반 Enter는 줄바꿈이고 메시지가 전송되지 않는다', async () => {
    const user = await renderChatScreen();

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '안녕하세요');
    await user.keyboard('{Enter}');

    // textarea라 일반 Enter는 줄바꿈으로 들어간다 — 전송이 아니다.
    expect(input.value).toContain('안녕하세요');
    expect(input.value).toContain('\n');
    expect(
      within(screen.getByTestId('message-list')).queryByText('안녕하세요'),
    ).not.toBeInTheDocument();
  });

  it('한글 조합을 Enter로 확정해도 줄바꿈이 생기지 않고 전송되지 않는다', async () => {
    await renderChatScreen();

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;

    // 한글 IME 조합 중 Enter로 글자를 확정하는 상황을 흉내낸다.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '안' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.compositionEnd(input, { data: '안' });

    // 조합 확정 Enter는 글자만 확정하고 여분의 줄바꿈을 넣지 않는다.
    expect(input.value).toBe('안');
    expect(within(screen.getByTestId('message-list')).queryByText('안')).not.toBeInTheDocument();
  });

  it('여러 줄로 쓴 메시지는 전송한 뒤에도 줄바꿈이 유지된다', async () => {
    const user = await renderChatScreen();

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '첫째 줄{Enter}둘째 줄');
    expect(input.value).toBe('첫째 줄\n둘째 줄');
    await user.click(screen.getByRole('button', { name: '전송' }));

    const messageList = screen.getByTestId('message-list');
    const bubble = await within(messageList).findByText(
      (_, node) => node?.textContent === '첫째 줄\n둘째 줄',
      { selector: 'div, button' },
      { timeout: 2000 },
    );
    // DOM에 줄바꿈이 그대로 남아 있고, 스타일이 그것을 보이게 한다.
    expect(bubble.textContent).toContain('\n');
    expect(bubble.className).toMatch(/whitespace-pre-wrap/);
    // 전송 후 입력창은 비워진다.
    expect(input.value).toBe('');
  });

  it('홈 새로고침 후 대화 첫 진입에도 입력창이 찌부러지지 않고, 여러 줄 초안이 탭 이동을 견딘다', async () => {
    const user = userEvent.setup();
    renderApp({ session: seedReviewSession() }); // 홈이 먼저 보이고 대화 화면은 숨겨진 채 마운트된다

    await user.click(screen.getByRole('button', { name: '대화' }));
    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    expect(input).toBeVisible();
    // 숨겨진 상태에서 잰 값(0)을 인라인 높이로 박아넣어 한 줄보다 낮아지면 안 된다.
    expect(input.style.height).not.toBe('0px');

    await user.type(input, '첫째 줄{Enter}둘째 줄');
    expect(input.value).toBe('첫째 줄\n둘째 줄');

    await user.click(screen.getByRole('button', { name: '홈' }));
    await user.click(screen.getByRole('button', { name: '대화' }));

    const back = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    expect(back).toBeVisible();
    expect(back.value).toBe('첫째 줄\n둘째 줄');
    expect(back.style.height).not.toBe('0px');
  });

  it('연결 끊김에서 실패한 메시지를 정상으로 돌아와 재전송하면 성공한다 — 같은 대화가 유지된다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 연결 끊김으로 전환해 메시지가 실패로 남게 한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '재전송 테스트');
    await user.click(screen.getByRole('button', { name: '전송' }));

    // 시드 대화에도 '저장 완료'된 내 메시지가 여러 개 있으므로, 상태 문구는 항상 방금 보낸
    // 메시지의 말풍선 안에서만(scoped) 확인한다.
    function findMyMessageRow() {
      const bubble = within(screen.getByTestId('message-list')).getByText('재전송 테스트');
      const row = bubble.parentElement;
      if (!row) throw new Error('메시지 행을 찾을 수 없습니다.');
      return row;
    }

    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('전송 실패')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // '정상'으로 돌아온다 — 연결 상태만 다를 뿐 같은 대화이므로 실패했던 메시지가 그대로 보여야 한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^정상/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    expect(within(findMyMessageRow()).getByText('전송 실패')).toBeInTheDocument();

    await user.click(within(findMyMessageRow()).getByRole('button', { name: '다시 보내기' }));

    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('저장 완료')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('전송 중 시나리오를 바꾸면 이전 요청의 완료 결과가 새 화면에 섞이지 않는다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '섞이면 안 되는 메시지');
    await user.click(screen.getByRole('button', { name: '전송' })); // '정상' 시나리오로 전송 시작(700ms 후 저장 완료)

    // 정착되기 전에 '빈 대화' 시나리오로 바로 전환한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /빈 대화/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    // '빈 대화'는 이 화면에 들어올 때마다 항상 비어 있어야 한다.
    expect(screen.getByText('아직 나눈 대화가 없어요')).toBeInTheDocument();

    // 이전 요청이 완료될 시간(700ms)이 지나도, 방금 보낸 메시지가 '빈 대화' 화면에 나타나면 안 된다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(screen.queryByText('섞이면 안 되는 메시지')).not.toBeInTheDocument();
    expect(screen.getByText('아직 나눈 대화가 없어요')).toBeInTheDocument();
  });

  it('같은 대화 안에서 상태를 바꿔도(정상 → AI 준비 중) 전송의 최종 상태가 표시된다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '상태 바꿔도 완료되는 메시지');
    await user.click(screen.getByRole('button', { name: '전송' })); // '정상'으로 전송 시작(700ms 후 저장 완료)

    // 정착되기 전에 같은 대화의 다른 상태('AI 준비 중')로 전환한다 — 연결·AI 상태만 다를 뿐 같은 대화다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /AI 준비 중/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    function findMyMessageRow() {
      const bubble = within(screen.getByTestId('message-list')).getByText(
        '상태 바꿔도 완료되는 메시지',
      );
      const row = bubble.parentElement;
      if (!row) throw new Error('메시지 행을 찾을 수 없습니다.');
      return row;
    }

    // 시나리오 이름만 비교하면 여기서 완료 결과를 버려 말풍선이 '전송 중'에 멈춘다 —
    // 같은 대화이므로 '저장 완료'까지 화면에 반영되어야 한다.
    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('저장 완료')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('같은 대화 안에서 상태를 바꿔도 재시도의 최종 상태가 표시된다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 연결 끊김으로 전환해 메시지를 '전송 실패'로 남긴다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '재시도 후 상태 전환 메시지');
    await user.click(screen.getByRole('button', { name: '전송' }));

    function findMyMessageRow() {
      const bubble = within(screen.getByTestId('message-list')).getByText(
        '재시도 후 상태 전환 메시지',
      );
      const row = bubble.parentElement;
      if (!row) throw new Error('메시지 행을 찾을 수 없습니다.');
      return row;
    }

    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('전송 실패')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // '정상'으로 돌아와 재시도를 시작하고, 정착되기 전에 'AI 준비 중'으로 전환한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^정상/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    await user.click(within(findMyMessageRow()).getByRole('button', { name: '다시 보내기' }));

    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /AI 준비 중/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    // 같은 대화이므로 재시도 성공('저장 완료')이 화면에 반영되어야 한다('전송 중'에 멈추지 않는다).
    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('저장 완료')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('빈 대화를 나갔다 다시 들어오면 이전 방문의 늦은 전송 결과가 섞이지 않는다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 빈 대화로 들어간다(첫 번째 방문).
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /빈 대화/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
    expect(screen.getByText('아직 나눈 대화가 없어요')).toBeInTheDocument();

    // 이 방문에서 메시지를 보낸다 — 같은 방문 동안에는 화면에 보인다.
    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '첫 방문에서 보낸 메시지');
    await user.click(screen.getByRole('button', { name: '전송' }));
    expect(
      within(screen.getByTestId('message-list')).getByText('첫 방문에서 보낸 메시지'),
    ).toBeInTheDocument();

    // 정착되기 전에 빈 대화를 나갔다가(→ 정상) 다시 들어온다(두 번째 방문).
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^정상/ }));
    await user.click(screen.getByRole('button', { name: /빈 대화/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    // 두 번째 방문은 항상 빈 화면으로 시작한다.
    expect(screen.getByText('아직 나눈 대화가 없어요')).toBeInTheDocument();

    // 첫 방문 요청이 완료될 시간(700ms)이 지나도, 그 결과가 두 번째 방문 화면에 섞이면 안 된다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(screen.queryByText('첫 방문에서 보낸 메시지')).not.toBeInTheDocument();
    expect(screen.getByText('아직 나눈 대화가 없어요')).toBeInTheDocument();
  });

  it('전송 중 다른 탭에 갔다 와도 완료된 메시지 상태가 반영된다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '탭 이동 중에도 완료되는 메시지');
    await user.click(screen.getByRole('button', { name: '전송' })); // 700ms 후 저장 완료

    // 정착 전에 홈 탭으로 이동 — 대화 화면은 숨겨질 뿐 언마운트되지 않는다.
    await user.click(screen.getByRole('button', { name: '홈' }));
    expect(screen.getByText(/함께한 지 [\d,]+일/)).toBeInTheDocument();
    // 숨겨진 대화 목록은 현재(홈) 탭에 보이지 않는다.
    expect(screen.getByTestId('message-list')).not.toBeVisible();

    // 대화 탭으로 복귀하면, 그 사이 완료된 전송의 최종 상태가 그대로 반영되어야 한다.
    await user.click(screen.getByRole('button', { name: '대화' }));

    function findMyMessageRow() {
      const bubble = within(screen.getByTestId('message-list')).getByText(
        '탭 이동 중에도 완료되는 메시지',
      );
      const row = bubble.parentElement;
      if (!row) throw new Error('메시지 행을 찾을 수 없습니다.');
      return row;
    }

    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('저장 완료')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('재시도 중 다른 탭에 갔다 와도 완료된 메시지 상태가 반영된다', async () => {
    const user = await renderChatScreen();

    await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 });

    // 연결 끊김으로 전환해 메시지를 '전송 실패'로 만든다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '재시도 탭 이동 메시지');
    await user.click(screen.getByRole('button', { name: '전송' }));

    function findMyMessageRow() {
      const bubble = within(screen.getByTestId('message-list')).getByText('재시도 탭 이동 메시지');
      const row = bubble.parentElement;
      if (!row) throw new Error('메시지 행을 찾을 수 없습니다.');
      return row;
    }

    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('전송 실패')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // '정상'으로 돌아와 재시도를 시작하고, 정착 전에 추억 탭으로 이동했다가 대화로 복귀한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^정상/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    await user.click(within(findMyMessageRow()).getByRole('button', { name: '다시 보내기' }));
    await user.click(screen.getByRole('button', { name: '추억' }));
    await user.click(screen.getByRole('button', { name: '대화' }));

    await waitFor(
      () => {
        expect(within(findMyMessageRow()).getByText('저장 완료')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

/** jsdom엔 Element.scrollTo가 없다 — 스크롤 호출을 관찰하려고 no-op 스텁을 심고 그 위에 스파이한다. */
function spyScrollTo() {
  const proto = HTMLElement.prototype as unknown as { scrollTo?: (options?: unknown) => void };
  if (!proto.scrollTo) proto.scrollTo = () => {};
  return vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
}

describe('대화 목록 스크롤', () => {
  it('첫 진입에서는 최신으로 이동하고, 탭을 다시 방문하면 스크롤을 건드리지 않는다', async () => {
    const scrollTo = spyScrollTo();
    const user = userEvent.setup();
    renderApp({ session: seedReviewSession() });

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(scrollTo).toHaveBeenCalled(); // 첫 진입 스크롤

    scrollTo.mockClear();
    await user.click(screen.getByRole('button', { name: '홈' }));
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(scrollTo).not.toHaveBeenCalled(); // 탭 재방문: 위치 유지

    scrollTo.mockRestore();
  });

  it('내가 메시지를 전송하면 최신 메시지로 이동한다', async () => {
    const scrollTo = spyScrollTo();
    const user = userEvent.setup();
    renderApp({ session: seedReviewSession() });
    await user.click(screen.getByRole('button', { name: '대화' }));
    scrollTo.mockClear();

    await user.type(screen.getByLabelText('메시지 입력'), '스크롤 따라와');
    await user.click(screen.getByRole('button', { name: '전송' }));

    await waitFor(() => expect(scrollTo).toHaveBeenCalled(), { timeout: 2000 });
    scrollTo.mockRestore();
  });
});

const DRAFT_HELP_NOTE = '추궁처럼 들릴 수 있어요. 열린 질문으로 바꿔볼까요?';
const DRAFT_HELP_PREVIEW = '이렇게: “무슨 일이 있었어?”';

describe('작성 중 표현 도움 (화면 검토용 예시)', () => {
  it('설정이 꺼져 있으면 예시 문구를 써도 도움말이 뜨지 않는다', async () => {
    const user = await renderChatScreen();

    await user.type(screen.getByLabelText('메시지 입력'), '너 왜 그렇게 했어');
    expect(screen.queryByText(DRAFT_HELP_NOTE)).not.toBeInTheDocument();
  });

  it('켜고 지정 예시 문구를 쓰면 이유와 실제 대체 문장을 함께 보여준다', async () => {
    const user = await renderChatScreen();
    await toggleSettingThenGoChat(user, /작성 중 표현 도움/);

    await user.type(screen.getByLabelText('메시지 입력'), '너 왜 그렇게 했어');
    expect(await screen.findByText(DRAFT_HELP_NOTE)).toBeInTheDocument();
    expect(screen.getByText(DRAFT_HELP_PREVIEW)).toBeInTheDocument();
    expect(screen.getByText('화면 검토용 예시')).toBeInTheDocument();
  });

  it('모든 지정 예시에서 적용 전에 실제 대체 문장을 보여준다', async () => {
    const user = await renderChatScreen();
    await toggleSettingThenGoChat(user, /작성 중 표현 도움/);
    const input = screen.getByLabelText('메시지 입력');

    for (const example of SEED_DRAFT_HELP_EXAMPLES) {
      await user.clear(input);
      await user.type(input, example.trigger);
      expect(await screen.findByText(`이렇게: “${example.alternative}”`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '이렇게 바꾸기' })).toBeInTheDocument();
    }
  });

  it("'이렇게 바꾸기'는 매칭된 구간만 교체하고 자동 전송하지 않는다", async () => {
    const user = await renderChatScreen();
    await toggleSettingThenGoChat(user, /작성 중 표현 도움/);

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '너 왜 그렇게 했어? 진짜 궁금해');
    await user.click(await screen.findByRole('button', { name: '이렇게 바꾸기' }));

    // 매칭 구간만 대체, 앞뒤 입력 보존, 물음표 중복 없음.
    expect(input.value).toBe('너 무슨 일이 있었어? 진짜 궁금해');
    // 초안에만 반영 — 전송되지 않는다.
    expect(
      within(screen.getByTestId('message-list')).queryByText(/무슨 일이 있었어/),
    ).not.toBeInTheDocument();
    // 적용 후 더 이상 매칭되지 않아 도움말이 사라진다.
    expect(screen.queryByText(DRAFT_HELP_NOTE)).not.toBeInTheDocument();
  });

  it("'이렇게 바꾸기'는 줄바꿈을 넘어 다음 줄을 지우지 않는다", async () => {
    const user = await renderChatScreen();
    await toggleSettingThenGoChat(user, /작성 중 표현 도움/);

    const input = screen.getByLabelText('메시지 입력') as HTMLTextAreaElement;
    await user.type(input, '왜 그렇게 했어{Enter}...아직 말하기 어렵다면 나중에 얘기해');
    await user.click(await screen.findByRole('button', { name: '이렇게 바꾸기' }));

    // 첫 표현만 바뀌고, 줄바꿈과 다음 줄(그 줄의 '...' 포함)은 그대로.
    expect(input.value).toBe('무슨 일이 있었어?\n...아직 말하기 어렵다면 나중에 얘기해');
  });

  it('한글 조합 중에는 도움말이 뜨지 않는다', async () => {
    const user = await renderChatScreen();
    await toggleSettingThenGoChat(user, /작성 중 표현 도움/);

    const input = screen.getByLabelText('메시지 입력');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '너 왜 그렇게 했어' } });
    expect(screen.queryByText(DRAFT_HELP_NOTE)).not.toBeInTheDocument();

    fireEvent.compositionEnd(input, { data: '어' });
    expect(await screen.findByText(DRAFT_HELP_NOTE)).toBeInTheDocument();
  });

  it('계정을 전환하면 초안과 도움말이 넘어가지 않는다', async () => {
    const user = await renderChatScreen();
    await toggleSettingThenGoChat(user, /작성 중 표현 도움/);

    await user.type(screen.getByLabelText('메시지 입력'), '너 왜 그렇게 했어');
    expect(await screen.findByText(DRAFT_HELP_NOTE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /서연/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    expect((screen.getByLabelText('메시지 입력') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(DRAFT_HELP_NOTE)).not.toBeInTheDocument();
  });
});
