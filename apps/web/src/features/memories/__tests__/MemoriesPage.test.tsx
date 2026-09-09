import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../App';
import { coupleKey, resetAllMockData, writeJSON } from '../../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

type User = ReturnType<typeof userEvent.setup>;

function renderApp(): User {
  const user = userEvent.setup();
  render(<App />);
  return user;
}

/** 추억 탭 화면(대화 화면이 숨겨진 채로 DOM에 남아 있어 텍스트가 겹치므로 스코프를 준다). */
function mem() {
  return within(screen.getByTestId('memories-page'));
}
function album() {
  return within(mem().getByText('우리 앨범').closest('section') as HTMLElement);
}

async function goTab(user: User, name: string) {
  await user.click(screen.getByRole('button', { name }));
}
async function openDevPanel(user: User) {
  await user.click(screen.getByRole('button', { name: /검토 도구/ }));
}
async function closeDevPanel(user: User) {
  await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
}
async function switchAccount(user: User, nickname: '민준' | '서연') {
  await openDevPanel(user);
  const switcher = within(screen.getByText('테스트 계정 전환').closest('section') as HTMLElement);
  await user.click(switcher.getByRole('button', { name: new RegExp(nickname) }));
  await closeDevPanel(user);
}
async function toggleRememberWhen(user: User, on: boolean) {
  await openDevPanel(user);
  await user.click(
    screen.getByRole('button', { name: `그때의 우리 리마인드 ${on ? '켬' : '끔'}` }),
  );
  await closeDevPanel(user);
}

async function openMemoryMenu(user: User, bodyPattern: RegExp) {
  await user.click(
    screen.getByRole('button', {
      name: new RegExp(`추억 메뉴 열기: ${bodyPattern.source}`),
    }),
  );
}

/** 대화 화면에서 저장 완료 메시지를 골라 메모와 함께 저장한다. */
async function saveFromChat(user: User, bodyPattern: RegExp, note?: string) {
  await goTab(user, '대화');
  await openMemoryMenu(user, bodyPattern);
  await user.click(screen.getByRole('button', { name: '추억으로 저장' }));
  if (note) await user.type(screen.getByLabelText('추억 메모'), note);
  await user.click(screen.getByRole('button', { name: '저장' }));
}

const SEED_MSG_3 = /아니 아직\.\.\. 입맛도 없고/;
const SEED_MSG_3_TEXT = '아니 아직... 입맛도 없고';

describe('추억 — 대화에서 저장', () => {
  it('저장 전 공유 안내가 보이고, 취소하면 저장되지 않는다', async () => {
    const user = renderApp();
    await goTab(user, '대화');

    await openMemoryMenu(user, SEED_MSG_3);
    await user.click(screen.getByRole('button', { name: '추억으로 저장' }));
    expect(screen.getByText('저장하면 상대에게도 보여요.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '취소' }));

    await goTab(user, '추억');
    expect(album().queryByText(SEED_MSG_3_TEXT)).not.toBeInTheDocument();
  });

  it('말풍선 메뉴는 Enter로도 열 수 있다', async () => {
    const user = renderApp();
    await goTab(user, '대화');

    screen
      .getByRole('button', { name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`) })
      .focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: '추억으로 저장' })).toBeInTheDocument();
  });

  it('말풍선 메뉴는 Space로도 열 수 있다', async () => {
    const user = renderApp();
    await goTab(user, '대화');

    screen
      .getByRole('button', { name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`) })
      .focus();
    await user.keyboard('[Space]');
    expect(screen.getByRole('button', { name: '추억으로 저장' })).toBeInTheDocument();
  });

  it('텍스트를 선택 중이면 말풍선을 눌러도 메뉴가 열리지 않는다', async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '대화' }));

    const bubble = screen.getByRole('button', {
      name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`),
    });
    const selection = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => '선택된 텍스트' } as Selection);

    fireEvent.pointerDown(bubble, { clientX: 4, clientY: 4 });
    fireEvent.click(bubble, { detail: 1, clientX: 4, clientY: 4 });
    expect(screen.queryByRole('button', { name: '추억으로 저장' })).not.toBeInTheDocument();

    selection.mockRestore();
  });

  it('말풍선을 드래그(포인터 이동)하면 메뉴가 열리지 않는다', async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '대화' }));

    const bubble = screen.getByRole('button', {
      name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`),
    });
    fireEvent.pointerDown(bubble, { clientX: 5, clientY: 5 });
    fireEvent.click(bubble, { detail: 1, clientX: 60, clientY: 5 });
    expect(screen.queryByRole('button', { name: '추억으로 저장' })).not.toBeInTheDocument();
  });

  it('저장 시트는 Tab 포커스를 안에 가둔다', async () => {
    const user = renderApp();
    await goTab(user, '대화');
    await user.click(
      screen.getByRole('button', { name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`) }),
    );

    const save = screen.getByRole('button', { name: '추억으로 저장' });
    const cancel = screen.getByRole('button', { name: '취소' });
    expect(save).toHaveFocus();

    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab(); // 마지막에서 첫 요소로 되돌아온다.
    expect(save).toHaveFocus();
    await user.tab({ shift: true }); // 첫 요소에서 마지막으로.
    expect(cancel).toHaveFocus();
  });

  it('메모 작성 중 계정을 전환하면 초안이 넘어가지 않는다', async () => {
    const user = renderApp();
    await goTab(user, '대화');
    await user.click(
      screen.getByRole('button', { name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`) }),
    );
    await user.click(screen.getByRole('button', { name: '추억으로 저장' }));
    await user.type(screen.getByLabelText('추억 메모'), '넘어가면 안 되는 초안');

    await switchAccount(user, '서연');
    // 시트가 닫힌다.
    expect(screen.queryByLabelText('추억 메모')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`) }),
    );
    await user.click(screen.getByRole('button', { name: '추억으로 저장' }));
    expect((screen.getByLabelText('추억 메모') as HTMLTextAreaElement).value).toBe('');
  });

  it('미리보기를 Esc로 닫으면 원래 말풍선으로 포커스가 돌아온다', async () => {
    const user = renderApp();
    await goTab(user, '대화');

    const bubble = screen.getByRole('button', {
      name: new RegExp(`추억 메뉴 열기: ${SEED_MSG_3.source}`),
    });
    await user.click(bubble);
    await user.click(screen.getByRole('button', { name: '추억으로 저장' }));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(bubble).toHaveFocus());
  });

  it('전송 중·실패한 메시지에는 저장 진입점이 없다', async () => {
    const user = renderApp();
    await goTab(user, '대화');

    await openDevPanel(user);
    await user.click(screen.getByRole('button', { name: /^연결 끊김/ }));
    await closeDevPanel(user);

    await user.type(screen.getByLabelText('메시지 입력'), '격리되는 메시지');
    await user.click(screen.getByRole('button', { name: '전송' }));

    await waitFor(
      () => {
        const row = within(screen.getByTestId('message-list')).getByText('격리되는 메시지');
        expect(within(row.parentElement as HTMLElement).getByText('전송 실패')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(
      screen.queryByRole('button', { name: /추억 메뉴 열기: 격리되는 메시지/ }),
    ).not.toBeInTheDocument();
  });

  it('저장 후 같은 메시지는 중복 저장되지 않는다', async () => {
    const user = renderApp();
    await saveFromChat(user, /고생했다 저녁은 먹었어\?/);

    await goTab(user, '대화');
    await openMemoryMenu(user, /고생했다 저녁은 먹었어\?/);
    expect(screen.getByText('이미 추억에 저장했어요')).toBeInTheDocument();
  });
});

describe('추억 — 앨범과 공유 범위', () => {
  it('저장한 추억은 양쪽 계정에서 메모·저장자와 함께 보인다', async () => {
    const user = renderApp();
    await saveFromChat(user, SEED_MSG_3, '이날 곁에 있어줘서 고마웠어');

    await goTab(user, '추억');
    expect(album().getByText('이날 곁에 있어줘서 고마웠어')).toBeInTheDocument();

    await switchAccount(user, '서연');
    await goTab(user, '추억');
    expect(album().getByText('이날 곁에 있어줘서 고마웠어')).toBeInTheDocument();
    expect(album().getAllByText(/민준 저장/).length).toBeGreaterThan(0);
  });

  it('메모 수정·삭제는 저장한 사람만 할 수 있다', async () => {
    const user = renderApp();
    await saveFromChat(user, SEED_MSG_3);

    await goTab(user, '추억');
    await user.click(album().getByRole('button', { name: SEED_MSG_3 }));
    expect(mem().getByRole('button', { name: '메모 수정' })).toBeInTheDocument();
    expect(mem().getByRole('button', { name: '추억 삭제' })).toBeInTheDocument();

    await user.click(mem().getByRole('button', { name: '추억 삭제' }));
    expect(
      mem().getByText('두 사람의 추억 목록에서 사라집니다. 원래 대화 메시지는 지워지지 않아요.'),
    ).toBeInTheDocument();
    await user.click(mem().getByRole('button', { name: '취소' }));
    await user.click(mem().getByRole('button', { name: '← 추억 목록' }));

    await switchAccount(user, '서연');
    await goTab(user, '추억');
    await user.click(album().getByRole('button', { name: SEED_MSG_3 }));
    expect(mem().queryByRole('button', { name: '메모 수정' })).not.toBeInTheDocument();
    expect(mem().queryByRole('button', { name: '추억 삭제' })).not.toBeInTheDocument();
  });

  it('카드·상세에 원래 발신자와 저장한 사람을 구분해 보여준다', async () => {
    // 서연이 보낸 메시지를 민준이 저장한다.
    const user = renderApp();
    await saveFromChat(user, SEED_MSG_3);

    await goTab(user, '추억');
    const card = album().getByText(SEED_MSG_3_TEXT).closest('button') as HTMLElement;
    expect(within(card).getByText(/서연의 말 · 대화 .+ · 민준 저장/)).toBeInTheDocument();

    await user.click(album().getByRole('button', { name: SEED_MSG_3 }));
    expect(mem().getByText(/서연의 말 · 대화/)).toBeInTheDocument();
    expect(mem().getByText('민준님이 간직했어요')).toBeInTheDocument();
  });

  it('메모 수정 중 계정을 전환하면 편집 초안이 넘어가지 않는다', async () => {
    const user = renderApp();
    await saveFromChat(user, SEED_MSG_3, '처음 메모');

    await goTab(user, '추억');
    await user.click(album().getByRole('button', { name: SEED_MSG_3 }));
    await user.click(mem().getByRole('button', { name: '메모 수정' }));
    await user.clear(mem().getByLabelText('추억 메모 수정'));
    await user.type(mem().getByLabelText('추억 메모 수정'), '버려질 편집');

    // 상세를 벗어나지 않고 상대(서연) 계정으로 전환 — 편집기가 닫히고 수정 버튼도 없다.
    await switchAccount(user, '서연');
    expect(mem().queryByLabelText('추억 메모 수정')).not.toBeInTheDocument();
    expect(mem().queryByRole('button', { name: '메모 수정' })).not.toBeInTheDocument();
    expect(mem().getByText('처음 메모')).toBeInTheDocument();

    // 저장자(민준)로 돌아와 다시 열면 버려진 초안이 아니라 원래 메모가 들어 있다.
    await switchAccount(user, '민준');
    await user.click(mem().getByRole('button', { name: '메모 수정' }));
    expect((mem().getByLabelText('추억 메모 수정') as HTMLTextAreaElement).value).toBe('처음 메모');
  });

  it('상세에서 하단 추억 탭을 누르면 목록으로 돌아온다', async () => {
    const user = renderApp();
    await saveFromChat(user, SEED_MSG_3, '돌아오기 메모');

    // 홈의 최근 추억 → 상세.
    await goTab(user, '홈');
    await user.click(screen.getByRole('button', { name: /돌아오기 메모/ }));
    expect(mem().getByRole('button', { name: '← 추억 목록' })).toBeInTheDocument();

    // 하단 '추억' 탭 → 목록.
    await goTab(user, '추억');
    expect(mem().queryByRole('button', { name: '← 추억 목록' })).not.toBeInTheDocument();
    expect(album().getByText('돌아오기 메모')).toBeInTheDocument();
  });

  it('추억을 삭제해도 원래 대화 메시지는 남는다', async () => {
    const user = renderApp();
    await saveFromChat(user, SEED_MSG_3);

    await goTab(user, '추억');
    await user.click(album().getByRole('button', { name: SEED_MSG_3 }));
    await user.click(mem().getByRole('button', { name: '추억 삭제' }));
    await user.click(mem().getByRole('button', { name: '삭제' }));

    await goTab(user, '대화');
    expect(
      within(screen.getByTestId('message-list')).getByText(SEED_MSG_3_TEXT),
    ).toBeInTheDocument();
  });

  it('메모를 수정해도 앨범 순서(저장일)는 바뀌지 않는다', async () => {
    const user = renderApp();
    await goTab(user, '추억');

    const oldestQuote = '바다 보러 가자던 말, 진짜 지키게 됐네';
    const newestQuote = '요즘 좀 힘들었어. 별일 아닌데 그냥 그래';
    const newestFirst = () => {
      const newest = album().getByText(newestQuote);
      const oldest = album().getByText(oldestQuote);
      return Boolean(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING);
    };
    expect(newestFirst()).toBe(true);

    await user.click(album().getByRole('button', { name: new RegExp(oldestQuote) }));
    await user.click(mem().getByRole('button', { name: '메모 수정' }));
    await user.clear(mem().getByLabelText('추억 메모 수정'));
    await user.type(mem().getByLabelText('추억 메모 수정'), '다시 읽어도 좋은 날');
    await user.click(mem().getByRole('button', { name: '저장' }));
    await user.click(mem().getByRole('button', { name: '← 추억 목록' }));

    expect(mem().getByText('다시 읽어도 좋은 날')).toBeInTheDocument();
    expect(newestFirst()).toBe(true);
  });

  it('앨범은 사진 중심 카드와 대화 중심 카드를 함께 보여준다', async () => {
    const user = renderApp();
    await goTab(user, '추억');

    expect(mem().getAllByText('예시 이미지').length).toBeGreaterThanOrEqual(2);
    expect(album().getByText('요즘 좀 힘들었어. 별일 아닌데 그냥 그래')).toBeInTheDocument();
  });

  it('빈 앨범이면 대화로 이동하는 안내를 보여준다', async () => {
    writeJSON(coupleKey('couple-1', 'memories'), []);
    const user = renderApp();
    await goTab(user, '추억');

    expect(mem().getByText(/아직 앨범이 비어 있어요/)).toBeInTheDocument();
    await user.click(mem().getByRole('button', { name: '대화로 이동' }));
    expect(screen.getByLabelText('메시지 입력')).toBeVisible();
  });

  it('새로고침 후에도 유지되고 홈의 최근 추억에서 상세로 갈 수 있다', async () => {
    const first = userEvent.setup();
    const view = render(<App />);
    await saveFromChat(first, SEED_MSG_3, '남겨두고 싶은 말');
    view.unmount();

    const user = userEvent.setup();
    render(<App />);
    await goTab(user, '홈');
    expect(screen.getByText(/남겨두고 싶은 말/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /남겨두고 싶은 말/ }));
    expect(mem().getByRole('button', { name: '← 추억 목록' })).toBeInTheDocument();
  });
});

describe('추억 — AI가 발견한 순간', () => {
  it('예시임을 알리고, 조작 전에 공유·숨김 범위를 안내한다', async () => {
    const user = renderApp();
    await goTab(user, '추억');

    expect(
      mem().getByText('AI가 대화에서 찾아볼 만한 순간의 예시예요. 실제 분석 결과가 아니에요.'),
    ).toBeInTheDocument();
    expect(
      mem().getByText('간직하면 두 사람의 앨범에 저장돼요. 숨기기는 내 목록에서만 적용돼요.'),
    ).toBeInTheDocument();
  });

  it('간직하기는 커플 공유 추억으로 저장하고, 그 제안은 목록에서 사라진다', async () => {
    const user = renderApp();
    await goTab(user, '추억');

    const card = mem().getByText('고생했다 저녁은 먹었어?').closest('article') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '간직하기' }));

    expect(mem().getByRole('button', { name: '← 추억 목록' })).toBeInTheDocument();
    await user.click(mem().getByRole('button', { name: '← 추억 목록' }));

    expect(album().getByText('고생했다 저녁은 먹었어?')).toBeInTheDocument();
    // ②에서는 사라진다.
    expect(
      mem().queryByText('발견 이유 · 힘든 하루 얘기가 나오자 안부를 먼저 물어본 순간이에요.'),
    ).not.toBeInTheDocument();

    await switchAccount(user, '서연');
    await goTab(user, '추억');
    expect(album().getByText('고생했다 저녁은 먹었어?')).toBeInTheDocument();
  });

  it("'숨기기'는 개인 적용이고, 추억 탭을 연 채 계정을 바꿔도 즉시 반영된다", async () => {
    const user = renderApp();
    await goTab(user, '추억');

    const card = mem().getByText('그렇구나. 오늘은 일단 좀 쉬자').closest('article') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: '숨기기' }));
    expect(mem().queryByText('그렇구나. 오늘은 일단 좀 쉬자')).not.toBeInTheDocument();

    await switchAccount(user, '서연');
    expect(mem().getByText('그렇구나. 오늘은 일단 좀 쉬자')).toBeInTheDocument();
  });

  it('분석 동의를 철회하면 AI 발견은 중단되고 직접 저장한 추억은 유지된다', async () => {
    const user = renderApp();
    await saveFromChat(user, SEED_MSG_3, '유지되는 메모');

    await goTab(user, '홈');
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(screen.getByLabelText(/AI 분석 동의/));
    await user.click(screen.getByRole('button', { name: '홈으로' }));

    await goTab(user, '추억');
    expect(mem().getByText('AI가 발견한 순간이 중단됐어요')).toBeInTheDocument();
    expect(album().getByText('유지되는 메모')).toBeInTheDocument();
  });
});

describe('추억 — 그때의 우리', () => {
  it("검토 도구로 켜면 '100일 전 오늘' 리마인드가 즉시 뜨고, 그 추억을 지우면 사라진다", async () => {
    const user = renderApp();
    await goTab(user, '추억');
    expect(mem().queryByText('그때의 우리')).not.toBeInTheDocument();

    await toggleRememberWhen(user, true);

    expect(mem().getByText('그때의 우리')).toBeInTheDocument();
    expect(mem().getByText('100일 전 오늘, 이런 대화를 나눴어요')).toBeInTheDocument();

    await user.click(mem().getByRole('button', { name: /100일 전 오늘/ }));
    await user.click(mem().getByRole('button', { name: '추억 삭제' }));
    await user.click(mem().getByRole('button', { name: '삭제' }));

    expect(mem().queryByText('그때의 우리')).not.toBeInTheDocument();
  });

  it("'이 리마인드 닫기'는 개인 적용", async () => {
    const user = renderApp();
    await toggleRememberWhen(user, true);
    await goTab(user, '추억');

    await user.click(mem().getByRole('button', { name: '이 리마인드 닫기' }));
    expect(mem().queryByText('그때의 우리')).not.toBeInTheDocument();

    await switchAccount(user, '서연');
    await goTab(user, '추억');
    expect(mem().getByText('그때의 우리')).toBeInTheDocument();
  });

  it('검토용 리마인드 날짜 변경은 앨범 정렬·저장일 라벨에 영향을 주지 않는다', async () => {
    const user = renderApp();
    await goTab(user, '추억');

    const newestFirst = () => {
      const newest = album().getByText('요즘 좀 힘들었어. 별일 아닌데 그냥 그래');
      const oldest = album().getByText('바다 보러 가자던 말, 진짜 지키게 됐네');
      return Boolean(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING);
    };
    const dateLabels = () =>
      album()
        .getAllByText(/저장$/)
        .map((el) => el.textContent);

    const labelsBefore = dateLabels();
    expect(newestFirst()).toBe(true);

    await toggleRememberWhen(user, true);

    expect(mem().getByText('100일 전 오늘, 이런 대화를 나눴어요')).toBeInTheDocument();
    expect(newestFirst()).toBe(true);
    expect(dateLabels()).toEqual(labelsBefore);
  });
});
