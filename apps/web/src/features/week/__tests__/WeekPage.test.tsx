import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../App';
import { resetAllMockData } from '../../../mocks/storage';

afterEach(() => {
  resetAllMockData();
});

type User = ReturnType<typeof userEvent.setup>;

async function openWeek(): Promise<User> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '우리' }));
  return user;
}

async function setSettingFromHome(user: User, label: RegExp) {
  await user.click(screen.getByRole('button', { name: '홈' }));
  await user.click(screen.getByRole('button', { name: '설정' }));
  await user.click(screen.getByLabelText(label));
  await user.click(screen.getByRole('button', { name: '홈으로' }));
  await user.click(screen.getByRole('button', { name: '우리' }));
}

async function switchAccount(user: User, name: RegExp) {
  await user.click(screen.getByRole('button', { name: /검토 도구/ }));
  await user.click(screen.getByRole('button', { name }));
  await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
}

async function setScenario(user: User, name: RegExp) {
  await user.click(screen.getByRole('button', { name: /검토 도구/ }));
  await user.click(screen.getByRole('button', { name }));
  await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
}

function cardFor(snippet: RegExp): HTMLElement {
  const el = screen.getByText(snippet).closest('section');
  if (!el) throw new Error('관찰 카드를 찾을 수 없습니다.');
  return el as HTMLElement;
}

async function expand(user: User, card: HTMLElement) {
  await user.click(within(card).getByRole('button', { name: /자세히 보기/ }));
}

const PAT1 = /힘든 얘기가 나오면/;
const PAT2 = /약속을 잡을 때/;
const PAT3 = /이모지로 마무리하고/;
const PAT4 = /서로 피곤한 날에는/;
const OPT_OUT_SCOPE = /두 사람의 대화 코칭과 이 리포트의 관련 제안에 사용하지 않아요/;

describe('우리 탭 — 요약/펼침 구조', () => {
  it('기본은 관찰·제안·자세히 보기만 보이고, 근거·의견·제외 조작은 펼쳐야 보인다', async () => {
    const user = await openWeek();
    const card = cardFor(PAT1);

    expect(within(card).getByText(/제안 ·/)).toBeInTheDocument();
    expect(within(card).queryByText(/근거:/)).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '의견 남기기' })).not.toBeInTheDocument();
    expect(within(card).queryByText(OPT_OUT_SCOPE)).not.toBeInTheDocument();

    await expand(user, card);
    expect(within(card).getByText(/근거:/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '의견 남기기' })).toBeInTheDocument();
    expect(within(card).getByText(OPT_OUT_SCOPE)).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: '접기' }));
    expect(within(card).queryByText(/근거:/)).not.toBeInTheDocument();
  });

  it('잠정 관찰 안내는 한 번만 나오고, 관찰 문구에 "확인되지 않음"을 반복하지 않는다', async () => {
    await openWeek();

    expect(screen.getByText(/아직 확인되지 않은 잠정 관찰/)).toBeInTheDocument();
    expect(screen.queryAllByText(/확인되지 않음/)).toHaveLength(0);
    // 각 관찰 카드에는 짧은 '미확인 가설' 칩이 있다(제외된 pat-4 제외 = 3개).
    expect(screen.getAllByText('미확인 가설')).toHaveLength(3);
  });

  it('제외된 카드는 접힌 상태에서도 코칭에서 제외됨을 표시하고 제안이 가려진다', async () => {
    await openWeek();
    const card = cardFor(PAT4);

    expect(within(card).getByText('코칭에서 제외됨')).toBeInTheDocument();
    expect(within(card).queryByText(/제안 ·/)).not.toBeInTheDocument();
    expect(within(card).getByText(/관련 제안은 가려져 있어요/)).toBeInTheDocument();
  });

  it('통계는 접힌 상태로 시작하고, 펼치면 메시지 수·그래프·하이라이트가 보인다', async () => {
    const user = await openWeek();

    expect(screen.getByText('이번 주 통계 · 보조 참고')).toBeInTheDocument();
    expect(screen.queryByText(/주고받은 메시지/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /이번 주 통계 · 보조 참고/ }));
    expect(screen.getByText(/주고받은 메시지/)).toBeInTheDocument();
    expect(screen.getByText(/금요일 저녁에 대화가 가장 활발했어요/)).toBeInTheDocument();
  });

  it('AI에게 물어보기는 작은 버튼이고, 리포트 상태와 무관하게 항상 보인다', async () => {
    const user = await openWeek();
    expect(screen.getByRole('button', { name: 'AI에게 물어보기' })).toBeInTheDocument();

    await setSettingFromHome(user, /AI 분석 동의/); // 분석 철회
    expect(screen.getByText('리포트와 패턴 관찰이 중단됐어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI에게 물어보기' })).toBeInTheDocument();
  });
});

describe('우리 탭 — 의견', () => {
  it('의견 입력창을 열기 전에는 공유 안내가 없고, 열면 안내가 먼저 보인다', async () => {
    const user = await openWeek();
    const card = cardFor(PAT1);
    await expand(user, card);

    expect(within(card).queryByText(/에게도 보여요/)).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '의견 남기기' }));
    expect(within(card).getByText(/에게도 보여요/)).toBeInTheDocument();
    expect(within(card).getByLabelText('의견 입력')).toBeInTheDocument();
  });

  it('두 사람이 남긴 의견은 중립적으로 나란히 표시되고, 본인 의견만 수정할 수 있다', async () => {
    const user = await openWeek();
    const card = cardFor(PAT3);
    await expand(user, card);

    expect(within(card).getByText('두 사람이 남긴 의견')).toBeInTheDocument();
    expect(
      within(card).getByText('이모지로 끝내는 게 편해서 자주 그러는 것 같아.'),
    ).toBeInTheDocument();
    expect(
      within(card).getByText('나는 대화가 잘 마무리됐다는 신호로 받아들였어.'),
    ).toBeInTheDocument();
    expect(within(card).getAllByRole('button', { name: '수정' })).toHaveLength(1);
    expect(within(card).queryByText(/갈렸|엇갈/)).not.toBeInTheDocument();
  });

  it('내 의견을 남기면 관찰 아래에 이름과 함께 쌓인다', async () => {
    const user = await openWeek();
    const card = cardFor(PAT1);
    await expand(user, card);

    await user.click(within(card).getByRole('button', { name: '의견 남기기' }));
    await user.type(within(card).getByLabelText('의견 입력'), '나는 이렇게 느꼈어');
    await user.click(within(card).getByRole('button', { name: '저장' }));

    expect(within(card).getByText('나는 이렇게 느꼈어')).toBeInTheDocument();
    expect(within(card).getByText(/민준\(나\)/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '의견 남기기' })).not.toBeInTheDocument();
  });

  it('의견 작성 중 계정을 전환하면 입력창·초안이 사라지고 다른 계정 이름으로 저장되지 않는다', async () => {
    const user = await openWeek();
    let card = cardFor(PAT1);
    await expand(user, card);

    await user.click(within(card).getByRole('button', { name: '의견 남기기' }));
    await user.type(within(card).getByLabelText('의견 입력'), '민준 초안');

    await switchAccount(user, /서연/);
    card = cardFor(PAT1);
    await expand(user, card);

    // 민준의 입력창·초안은 서연 화면으로 넘어오지 않는다.
    expect(within(card).queryByLabelText('의견 입력')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '의견 남기기' })).toBeInTheDocument();

    // 서연이 자기 의견을 남기면 서연 이름으로 저장된다.
    await user.click(within(card).getByRole('button', { name: '의견 남기기' }));
    await user.type(within(card).getByLabelText('의견 입력'), '서연 의견');
    await user.click(within(card).getByRole('button', { name: '저장' }));
    expect(within(card).getByText('서연 의견')).toBeInTheDocument();
    expect(within(card).getByText(/서연\(나\)/)).toBeInTheDocument();
    expect(screen.queryByText('민준 초안')).not.toBeInTheDocument();

    // 민준으로 돌아와도 민준 초안은 저장된 적이 없다.
    await switchAccount(user, /민준/);
    card = cardFor(PAT1);
    await expand(user, card);
    expect(screen.queryByText('민준 초안')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '의견 남기기' })).toBeInTheDocument();
  });

  it('기존 의견 수정 중 계정을 전환하면 수정이 취소되고 원문이 유지된다', async () => {
    const user = await openWeek();
    let card = cardFor(PAT2); // op-1은 민준이 쓴 의견
    await expand(user, card);

    await user.click(within(card).getByRole('button', { name: '수정' }));
    const editor = within(card).getByLabelText('의견 입력');
    await user.clear(editor);
    await user.type(editor, '몰래 고침');

    await switchAccount(user, /서연/);
    card = cardFor(PAT2);
    await expand(user, card);

    // 수정은 반영되지 않았고, 서연은 민준 의견을 수정할 수 없다.
    expect(within(card).queryByLabelText('의견 입력')).not.toBeInTheDocument();
    expect(screen.queryByText('몰래 고침')).not.toBeInTheDocument();
    expect(within(card).getByText(/내가 날짜를 잘 던지는 편이긴 해/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '수정' })).not.toBeInTheDocument();
  });
});

describe('우리 탭 — 코칭 활용 중단', () => {
  it('상대가 제외한 관찰은 내가 해제할 수 없다', async () => {
    const user = await openWeek();
    const card = cardFor(PAT4);
    await expand(user, card);

    expect(within(card).getByText(/서연님이 이 관찰을 코칭에서 제외했어요/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '내 제외 해제' })).not.toBeInTheDocument();
  });

  it('내가 제외하면 카드가 "코칭에서 제외됨"으로 바뀌고 요약의 제안이 사라진다', async () => {
    const user = await openWeek();
    const card = cardFor(PAT1);

    expect(within(card).getByText(/제안 ·/)).toBeInTheDocument();
    await expand(user, card);
    await user.click(within(card).getByRole('button', { name: '이 관찰을 코칭에서 제외하기' }));

    expect(within(card).getByText('코칭에서 제외됨')).toBeInTheDocument();
    expect(within(card).queryByText(/제안 ·/)).not.toBeInTheDocument();
    expect(within(card).getByText(/관련 제안은 가려져 있어요/)).toBeInTheDocument();
  });
});

describe('우리 탭 — 코칭 활용 중단이 두 계정 대화 화면에 반영된다 (0004 §5)', () => {
  it('기본엔 두 계정 모두 코칭이 나오고, 한쪽이 제외하면 두 계정 모두 가려진다', async () => {
    const user = await openWeek();

    // 기본: 서연 대화 화면에도 pat-1에 연결된 코칭이 있다.
    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    // 민준이 pat-1을 코칭에서 제외한다.
    await switchAccount(user, /민준/);
    await user.click(screen.getByRole('button', { name: '우리' }));
    const card = cardFor(PAT1);
    await expand(user, card);
    await user.click(within(card).getByRole('button', { name: '이 관찰을 코칭에서 제외하기' }));

    // 민준 대화 화면이 가려진다.
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(
        '이 관찰을 코칭에 사용하지 않기로 해서 관련 코칭을 표시하지 않아요.',
        undefined,
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();

    // 서연 대화 화면도 함께 가려진다(한쪽 제외가 양측에 반영).
    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(
        '이 관찰을 코칭에 사용하지 않기로 해서 관련 코칭을 표시하지 않아요.',
        undefined,
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
  });

  it('두 사람이 모두 제외하면 한 명이 해제해도 계속 가려지고, 마지막 해제로 복구된다', async () => {
    const user = await openWeek();

    // 민준이 제외
    let card = cardFor(PAT1);
    await expand(user, card);
    await user.click(within(card).getByRole('button', { name: '이 관찰을 코칭에서 제외하기' }));

    // 서연도 제외
    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '우리' }));
    card = cardFor(PAT1);
    await expand(user, card);
    expect(within(card).getByText(/민준님이 이 관찰을 코칭에서 제외했어요/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '나도 코칭에서 제외하기' }));

    // 서연이 자신의 제외만 해제 — 민준 것이 남아 여전히 제외 상태
    await user.click(within(card).getByRole('button', { name: '내 제외 해제' }));
    expect(within(card).getByText('코칭에서 제외됨')).toBeInTheDocument();

    // 민준 대화 화면은 여전히 가려져 있다
    await switchAccount(user, /민준/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(
        '이 관찰을 코칭에 사용하지 않기로 해서 관련 코칭을 표시하지 않아요.',
        undefined,
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();

    // 민준이 마지막 제외를 해제하면 두 계정 코칭이 복구된다
    await user.click(screen.getByRole('button', { name: '우리' }));
    card = cardFor(PAT1);
    await expand(user, card);
    await user.click(within(card).getByRole('button', { name: '내 제외 해제' }));
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText('새로운 대화 힌트가 있어요', undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});

describe('우리 탭 — 상태 처리', () => {
  it('분석을 철회하면 리포트·패턴 관찰이 중단된다', async () => {
    const user = await openWeek();
    expect(screen.getByText('소통 패턴 관찰')).toBeInTheDocument();

    await setSettingFromHome(user, /AI 분석 동의/);
    expect(screen.getByText('리포트와 패턴 관찰이 중단됐어요')).toBeInTheDocument();
    expect(screen.queryByText('소통 패턴 관찰')).not.toBeInTheDocument();
  });

  it('대화 부족·분석 준비 중·장애를 서로 다른 안내로 구분한다', async () => {
    const user = await openWeek();

    await setScenario(user, /빈 대화/);
    expect(screen.getByText('리포트를 만들 만큼 대화가 많지 않았어요')).toBeInTheDocument();

    await setScenario(user, /AI 준비 중/);
    expect(screen.getByText('이번 주 리포트를 준비하고 있어요')).toBeInTheDocument();

    await setScenario(user, /AI 장애/);
    expect(screen.getByText('지금은 리포트를 불러올 수 없어요')).toBeInTheDocument();
  });

  it('코칭 카드 표시만 끄면 우리 탭 리포트는 그대로 유지된다', async () => {
    const user = await openWeek();
    await setSettingFromHome(user, /코칭 카드 표시/);

    expect(screen.getByText('소통 패턴 관찰')).toBeInTheDocument();
    expect(screen.getByText(PAT1)).toBeInTheDocument();
  });
});
