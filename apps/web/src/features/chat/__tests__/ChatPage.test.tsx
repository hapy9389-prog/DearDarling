import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../App';
import { resetAllMockData } from '../../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

const SUGGESTION_TEXT = '혹시 무슨 일 있었어? 얘기하고 싶으면 들어줄게';

describe('대화 화면 핵심 동작', () => {
  it('추천 답장은 초안에만 채워지고, 전송 버튼을 눌러야 실제로 전송된다', async () => {
    const user = userEvent.setup();
    render(<App />);

    const chip = await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });
    await user.click(chip);

    const suggestionButton = await screen.findByText(SUGGESTION_TEXT);
    await user.click(suggestionButton);

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
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
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    await user.click(screen.getByRole('button', { name: /검토 도구/ }));

    const consentToggle = screen.getByLabelText(/AI 분석 동의/);
    await user.click(consentToggle); // 철회

    expect(
      await screen.findByText('AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'),
    ).toBeInTheDocument();

    await user.click(consentToggle); // 다시 동의(원상 복구)
    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    const visibilityToggle = screen.getByLabelText(/코칭 카드 표시/);
    await user.click(visibilityToggle); // 코칭 카드만 숨김

    expect(
      await screen.findByText('코칭 카드를 숨겨두었어요. 분석은 계속되고 있어요.'),
    ).toBeInTheDocument();
    // 분석 철회 때 나온 문구와는 분명히 다른 문구여야 한다.
    expect(
      screen.queryByText('AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'),
    ).not.toBeInTheDocument();
  });

  it('AI 준비 중 시나리오여도 분석을 철회하면 분석 중단 안내가 먼저 보인다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /AI 준비 중/ }));

    const consentToggle = screen.getByLabelText(/AI 분석 동의/);
    await user.click(consentToggle); // 철회

    // 분석 동의·철회가 AI 준비 상태보다 우선이어야 한다.
    expect(
      await screen.findByText('AI 분석에 동의하면 이 대화의 코칭을 받을 수 있어요.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('AI가 아직 대화를 살펴보고 있어요. 잠시 후 다시 확인해 주세요.'),
    ).not.toBeInTheDocument();
  });

  it('전송 중이거나 실패한 메시지는 보낸 사람에게만 보이고, 상대방에게는 저장 완료된 메시지만 보인다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    // 연결이 끊긴 시나리오로 바꿔 전송이 '전송 중 → 실패'로 남게 한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
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

  it('입력창에서 Enter를 눌러도 메시지가 전송되지 않는다', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
    await user.type(input, '안녕하세요');
    await user.keyboard('{Enter}');

    expect(input.value).toBe('안녕하세요');
    expect(
      within(screen.getByTestId('message-list')).queryByText('안녕하세요'),
    ).not.toBeInTheDocument();
  });

  it('한글 조합을 Enter로 확정해도 메시지가 전송되지 않는다', async () => {
    render(<App />);

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;

    // 한글 IME 조합 중 Enter로 글자를 확정하는 상황을 흉내낸다.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '안' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.compositionEnd(input, { data: '안' });

    expect(input.value).toBe('안');
    expect(within(screen.getByTestId('message-list')).queryByText('안')).not.toBeInTheDocument();
  });

  it('연결 끊김에서 실패한 메시지를 정상으로 돌아와 재전송하면 성공한다 — 같은 대화가 유지된다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    // 연결 끊김으로 전환해 메시지가 실패로 남게 한다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
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
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
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
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
    await user.type(input, '상태 바꿔도 완료되는 메시지');
    await user.click(screen.getByRole('button', { name: '전송' })); // '정상'으로 전송 시작(700ms 후 저장 완료)

    // 정착되기 전에 같은 대화의 다른 상태('AI 준비 중')로 전환한다 — 연결·AI 상태만 다를 뿐 같은 대화다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /AI 준비 중/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    function findMyMessageRow() {
      const bubble = within(screen.getByTestId('message-list')).getByText('상태 바꿔도 완료되는 메시지');
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
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    // 연결 끊김으로 전환해 메시지를 '전송 실패'로 남긴다.
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));

    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
    await user.type(input, '재시도 후 상태 전환 메시지');
    await user.click(screen.getByRole('button', { name: '전송' }));

    function findMyMessageRow() {
      const bubble = within(screen.getByTestId('message-list')).getByText('재시도 후 상태 전환 메시지');
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
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 });

    // 빈 대화로 들어간다(첫 번째 방문).
    await user.click(screen.getByRole('button', { name: /검토 도구/ }));
    await user.click(screen.getByRole('button', { name: /빈 대화/ }));
    await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
    expect(screen.getByText('아직 나눈 대화가 없어요')).toBeInTheDocument();

    // 이 방문에서 메시지를 보낸다 — 같은 방문 동안에는 화면에 보인다.
    const input = screen.getByLabelText('메시지 입력') as HTMLInputElement;
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
});
