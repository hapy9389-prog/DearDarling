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

async function withDevTool(user: User, buttonName: RegExp) {
  await user.click(screen.getByRole('button', { name: /검토 도구/ }));
  await user.click(screen.getByRole('button', { name: buttonName }));
  await user.click(screen.getByRole('button', { name: '검토 도구 닫기' }));
}

const switchAccount = (user: User, name: RegExp) => withDevTool(user, name);
const setScenario = (user: User, name: RegExp) => withDevTool(user, name);
const setWeeklyFindings = (user: User, name: '이번 주 발견 있음' | '이번 주 발견 없음') =>
  withDevTool(user, new RegExp(name));

/** 대표 발견 섹션(있을 때)이나 '눈에 띈 흐름 없음' 안내 섹션을 감싸는 <section>. */
function headline(): HTMLElement {
  const el = screen.getByText('이번 주 눈에 띈 우리 모습').closest('section');
  if (!el) throw new Error('대표 발견 섹션을 찾을 수 없습니다.');
  return el as HTMLElement;
}

async function openHeadlineControls(user: User) {
  await user.click(within(headline()).getByRole('button', { name: /의견 남기기.*코칭 제외/ }));
}

function otherFindingsToggle(): HTMLElement {
  return screen.getByRole('button', { name: /다른 발견 보기/ });
}

async function openOtherFindings(user: User) {
  await user.click(otherFindingsToggle());
}

function otherCard(snippet: RegExp): HTMLElement {
  const el = screen.getByText(snippet).closest('section');
  if (!el) throw new Error('관찰 카드를 찾을 수 없습니다.');
  return el as HTMLElement;
}

async function expandOther(user: User, card: HTMLElement) {
  await user.click(within(card).getByRole('button', { name: /자세히 보기/ }));
}

const HEADLINE_TITLE = '무거운 대화를 한 번에 끝내지 않아요';
const PAT1 = /힘든 얘기가 나온 날은/;
const PAT2 = /약속을 잡을 때/;
const PAT3 = /이모지로 마무리하고/;
const PAT4 = /서로 피곤한 날에는/;
const OPT_OUT_SCOPE = /두 사람의 대화 코칭과 이 리포트의 관련 실천 제안에 사용하지 않아요/;
const WITHHELD_IN_CHAT = '이 관찰을 코칭에 사용하지 않기로 해서 관련 코칭을 표시하지 않아요.';

describe('우리 탭 — 상단 통계', () => {
  it('핵심 통계 3개와 요일 막대·하이라이트가 펼치지 않아도 상단에 보인다', async () => {
    await openWeek();

    expect(screen.getByText('이번 주 통계')).toBeInTheDocument();
    expect(screen.getByText('주고받은 메시지')).toBeInTheDocument();
    expect(screen.getByText('214개')).toBeInTheDocument();
    expect(screen.getByText('대화한 날')).toBeInTheDocument();
    expect(screen.getByText('많았던 요일')).toBeInTheDocument();
    expect(screen.getByText('금요일')).toBeInTheDocument();
    expect(screen.getByText(/금요일에 주고받은 메시지가 가장 많았어요/)).toBeInTheDocument();
  });

  it('관계 점수·순위나 근거 없는 시간대 단정을 넣지 않는다', async () => {
    await openWeek();
    const stats = screen.getByText('이번 주 통계').closest('section') as HTMLElement;

    expect(within(stats).queryByText(/점수|순위|랭킹/)).not.toBeInTheDocument();
    // 요일 통계만 있으므로 '저녁' 같은 시간대는 단정하지 않는다.
    expect(within(stats).queryByText(/저녁/)).not.toBeInTheDocument();
  });

  it('상단 잠정 안내는 한 번만 나오고, 미확인 가설 칩은 없다', async () => {
    const user = await openWeek();

    expect(
      screen.getByText('대화에서 이런 모습이 보였어요. 두 사람이 느낀 것과는 다를 수 있어요.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByText(/미확인 가설/)).toHaveLength(0);

    await openOtherFindings(user);
    expect(screen.queryAllByText(/미확인 가설/)).toHaveLength(0);
  });
});

describe('우리 탭 — 이번 주 핵심 발견', () => {
  it('제목·도식·관찰·해석·근거·실천 하나로 대표 발견을 보여준다', async () => {
    await openWeek();
    const card = headline();

    expect(within(card).getByRole('heading', { name: HEADLINE_TITLE })).toBeInTheDocument();
    expect(within(card).getByText('그날은 짧게')).toBeInTheDocument();
    expect(within(card).getByText('며칠 뒤 다시')).toBeInTheDocument();

    expect(within(card).getByText('관찰한 모습')).toBeInTheDocument();
    expect(within(card).getByText(PAT1)).toBeInTheDocument();

    expect(within(card).getByText('이렇게 이해해 볼 수도 있어요')).toBeInTheDocument();
    const interpretation = within(card).getAllByText(
      /시간을 두는 방식일 수 있어요|마음을 정리할 여유/,
    );
    expect(interpretation.length).toBeGreaterThan(0);
    expect(interpretation.length).toBeLessThanOrEqual(2);

    expect(within(card).getByText('근거가 된 대화')).toBeInTheDocument();
    expect(within(card).getByText(/그날 대화를 짧게 맺은 부분/)).toBeInTheDocument();
    expect(within(card).getByText(/지금은 좀 괜찮아\?”라고 먼저 물어본 부분/)).toBeInTheDocument();

    expect(within(card).getByText('작은 실천 하나')).toBeInTheDocument();
    expect(within(card).getByText(/그때 얘기 더 해도 돼/)).toBeInTheDocument();
  });

  it('의견·코칭 제외 조작은 펼쳐야 보이고, 조작 전에 의견·제외 안내를 구분해 보여준다', async () => {
    const user = await openWeek();
    const card = headline();

    expect(within(card).queryByText(OPT_OUT_SCOPE)).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '의견 남기기' })).not.toBeInTheDocument();

    await openHeadlineControls(user);
    // 의견 공개와 코칭 제외 적용을 각각 한 문장으로 구분해 안내한다.
    expect(within(card).getByText(/남긴 의견은 상대에게도 보여요/)).toBeInTheDocument();
    expect(
      within(card).getByText(/코칭에서 제외하면 두 사람의 관련 코칭에 모두 적용돼요/),
    ).toBeInTheDocument();
    expect(within(card).getByText(OPT_OUT_SCOPE)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '의견 남기기' })).toBeInTheDocument();
  });
});

describe('우리 탭 — 다른 발견 보기', () => {
  it('기본은 접혀 있고, 펼치면 나머지 관찰이 카드로 나온다', async () => {
    const user = await openWeek();

    expect(otherFindingsToggle().textContent).toMatch(/3/);
    expect(screen.queryByText(PAT2)).not.toBeInTheDocument();

    await openOtherFindings(user);
    expect(screen.getByText(PAT2)).toBeInTheDocument();
    expect(screen.getByText(PAT3)).toBeInTheDocument();
    expect(screen.getByText(PAT4)).toBeInTheDocument();
  });

  it('제외된 관찰(pat-4)은 접혀도 부드럽게 표시되고 실천 제안이 가려진다', async () => {
    const user = await openWeek();
    await openOtherFindings(user);
    const card = otherCard(PAT4);

    expect(
      within(card).getByText(
        /지금은 코칭에 사용하지 않고 있어요 — 관련 실천 제안은 표시하지 않아요/,
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/작은 실천 ·/)).not.toBeInTheDocument();
  });

  it('두 사람이 남긴 의견은 중립적으로 나란히 표시되고, 본인 의견만 수정할 수 있다', async () => {
    const user = await openWeek();
    await openOtherFindings(user);
    const card = otherCard(PAT3);
    await expandOther(user, card);

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
});

describe('우리 탭 — 의견', () => {
  it('의견 입력창을 열기 전에는 공유 안내가 없고, 열면 안내가 먼저 보인다', async () => {
    const user = await openWeek();
    await openHeadlineControls(user);
    const card = headline();

    expect(within(card).queryByText(/에게도 보여요\. 두 사람의 의견은/)).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '의견 남기기' }));
    expect(within(card).getByText(/에게도 보여요\. 두 사람의 의견은/)).toBeInTheDocument();
    expect(within(card).getByLabelText('의견 입력')).toBeInTheDocument();
  });

  it('내 의견을 남기면 대표 발견 아래에 이름과 함께 쌓인다', async () => {
    const user = await openWeek();
    await openHeadlineControls(user);
    const card = headline();

    await user.click(within(card).getByRole('button', { name: '의견 남기기' }));
    await user.type(within(card).getByLabelText('의견 입력'), '나는 이렇게 느꼈어');
    await user.click(within(card).getByRole('button', { name: '저장' }));

    expect(within(card).getByText('나는 이렇게 느꼈어')).toBeInTheDocument();
    expect(within(card).getByText(/민준\(나\)/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '의견 남기기' })).not.toBeInTheDocument();
  });

  it('의견 작성 중 계정을 전환하면 입력창·초안이 사라지고 다른 계정 이름으로 저장되지 않는다', async () => {
    const user = await openWeek();
    await openHeadlineControls(user);
    await user.click(within(headline()).getByRole('button', { name: '의견 남기기' }));
    await user.type(within(headline()).getByLabelText('의견 입력'), '민준 초안');

    await switchAccount(user, /서연/);
    await openHeadlineControls(user);

    expect(within(headline()).queryByLabelText('의견 입력')).not.toBeInTheDocument();
    expect(within(headline()).getByRole('button', { name: '의견 남기기' })).toBeInTheDocument();

    await user.click(within(headline()).getByRole('button', { name: '의견 남기기' }));
    await user.type(within(headline()).getByLabelText('의견 입력'), '서연 의견');
    await user.click(within(headline()).getByRole('button', { name: '저장' }));
    expect(within(headline()).getByText('서연 의견')).toBeInTheDocument();
    expect(within(headline()).getByText(/서연\(나\)/)).toBeInTheDocument();
    expect(screen.queryByText('민준 초안')).not.toBeInTheDocument();

    await switchAccount(user, /민준/);
    await openHeadlineControls(user);
    expect(screen.queryByText('민준 초안')).not.toBeInTheDocument();
    expect(within(headline()).getByRole('button', { name: '의견 남기기' })).toBeInTheDocument();
  });

  it('다른 발견의 기존 의견 수정 중 계정을 전환하면 수정이 취소되고 원문이 유지된다', async () => {
    const user = await openWeek();
    await openOtherFindings(user);
    let card = otherCard(PAT2); // op-1은 민준이 쓴 의견
    await expandOther(user, card);

    await user.click(within(card).getByRole('button', { name: '수정' }));
    const editor = within(card).getByLabelText('의견 입력');
    await user.clear(editor);
    await user.type(editor, '몰래 고침');

    await switchAccount(user, /서연/);
    await openOtherFindings(user);
    card = otherCard(PAT2);
    await expandOther(user, card);

    expect(within(card).queryByLabelText('의견 입력')).not.toBeInTheDocument();
    expect(screen.queryByText('몰래 고침')).not.toBeInTheDocument();
    expect(within(card).getByText(/내가 날짜를 잘 던지는 편이긴 해/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '수정' })).not.toBeInTheDocument();
  });
});

describe('우리 탭 — 코칭 활용 중단', () => {
  it('대표 발견을 제외하면 실천 제안이 사라지고 부드러운 안내로 바뀐다', async () => {
    const user = await openWeek();
    expect(within(headline()).getByText('작은 실천 하나')).toBeInTheDocument();

    await openHeadlineControls(user);
    await user.click(
      within(headline()).getByRole('button', { name: '이 관찰을 코칭에서 제외하기' }),
    );

    expect(within(headline()).queryByText('작은 실천 하나')).not.toBeInTheDocument();
    expect(
      within(headline()).getByText(
        /지금은 코칭에 사용하지 않고 있어요 — 관련 실천 제안은 표시하지 않아요/,
      ),
    ).toBeInTheDocument();
  });

  it('다른 발견에서 상대가 제외한 관찰은 내가 해제할 수 없다', async () => {
    const user = await openWeek();
    await openOtherFindings(user);
    const card = otherCard(PAT4);
    await expandOther(user, card);

    expect(within(card).getByText(/서연님이 이 관찰을 코칭에서 제외했어요/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: '내 제외 해제' })).not.toBeInTheDocument();
  });
});

describe('우리 탭 — 코칭 활용 중단이 두 계정 대화 화면에 반영된다 (0004 §5)', () => {
  it('기본엔 두 계정 모두 코칭이 나오고, 대표 발견을 한쪽이 제외하면 두 계정 모두 가려진다', async () => {
    const user = await openWeek();

    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 }),
    ).toBeInTheDocument();

    await switchAccount(user, /민준/);
    await user.click(screen.getByRole('button', { name: '우리' }));
    await openHeadlineControls(user);
    await user.click(
      within(headline()).getByRole('button', { name: '이 관찰을 코칭에서 제외하기' }),
    );

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it('두 사람이 모두 제외하면 한 명이 해제해도 계속 가려지고, 마지막 해제로 복구된다', async () => {
    const user = await openWeek();

    await openHeadlineControls(user);
    await user.click(
      within(headline()).getByRole('button', { name: '이 관찰을 코칭에서 제외하기' }),
    );

    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '우리' }));
    await openHeadlineControls(user);
    expect(
      within(headline()).getByText(/민준님이 이 관찰을 코칭에서 제외했어요/),
    ).toBeInTheDocument();
    await user.click(within(headline()).getByRole('button', { name: '나도 코칭에서 제외하기' }));

    await user.click(within(headline()).getByRole('button', { name: '내 제외 해제' }));
    expect(within(headline()).getByText(/관련 실천 제안은 표시하지 않아요/)).toBeInTheDocument();

    await switchAccount(user, /민준/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '우리' }));
    await openHeadlineControls(user);
    await user.click(within(headline()).getByRole('button', { name: '내 제외 해제' }));
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByRole('button', { name: '코칭 카드 펼치기' }, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("검토용 '이번 주 발견 없음'으로 전환해도 기존 코칭 제외는 유지된다", async () => {
    const user = await openWeek();

    // 1) 민준이 대표 발견을 코칭에서 제외 → 양측 대화 코칭이 가려진다.
    await openHeadlineControls(user);
    await user.click(
      within(headline()).getByRole('button', { name: '이 관찰을 코칭에서 제외하기' }),
    );
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    // 2) '이번 주 발견 없음'으로 전환 — 통계·안내는 유지되고, 코칭은 계속 가려진다.
    await switchAccount(user, /민준/);
    await user.click(screen.getByRole('button', { name: '우리' }));
    await setWeeklyFindings(user, '이번 주 발견 없음');
    expect(screen.getByText('이번 주 통계')).toBeInTheDocument();
    expect(screen.getByText(/이번 주는 특별히 눈에 띈 흐름은 없었어요/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    await switchAccount(user, /서연/);
    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();

    // 3) '이번 주 발견 있음'으로 복귀해도 제외는 그대로 — 대표 발견 카드도 코칭 미사용 상태.
    await switchAccount(user, /민준/);
    await user.click(screen.getByRole('button', { name: '우리' }));
    await setWeeklyFindings(user, '이번 주 발견 있음');
    expect(within(headline()).getByText(/관련 실천 제안은 표시하지 않아요/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '대화' }));
    expect(
      await screen.findByText(WITHHELD_IN_CHAT, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});

describe('우리 탭 — 상태 처리', () => {
  it('관찰이 0건이어도 대화·통계가 충분하면 대화 부족으로 판단하지 않는다', async () => {
    const user = await openWeek();

    await setWeeklyFindings(user, '이번 주 발견 없음');

    // '대화 부족' 상태 카드가 아니라, 통계 + '눈에 띈 흐름 없음' 안내를 유지한다.
    expect(screen.queryByText('리포트를 만들 만큼 대화가 많지 않았어요')).not.toBeInTheDocument();
    expect(screen.getByText('이번 주 통계')).toBeInTheDocument();
    expect(screen.getByText('214개')).toBeInTheDocument();
    expect(screen.getByText(/이번 주는 특별히 눈에 띈 흐름은 없었어요/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: HEADLINE_TITLE })).not.toBeInTheDocument();
    // 관찰 자체가 없으므로 '다른 발견 보기'도 없다.
    expect(screen.queryByRole('button', { name: /다른 발견 보기/ })).not.toBeInTheDocument();
  });

  it("'대화 부족'(빈 대화)은 통계도 안내도 없이 별도 상태 카드로만 보인다", async () => {
    const user = await openWeek();

    await setScenario(user, /빈 대화/);
    expect(screen.getByText('리포트를 만들 만큼 대화가 많지 않았어요')).toBeInTheDocument();
    expect(screen.queryByText('이번 주 통계')).not.toBeInTheDocument();
    expect(screen.queryByText(/이번 주는 특별히 눈에 띈 흐름은 없었어요/)).not.toBeInTheDocument();
  });

  it('분석을 철회하면 리포트가 중단되지만 AI에게 물어보기는 계속 보인다', async () => {
    const user = await openWeek();
    expect(screen.getByRole('button', { name: 'AI에게 물어보기' })).toBeInTheDocument();

    await setSettingFromHome(user, /AI 분석 동의/);
    expect(screen.getByText('리포트와 패턴 관찰이 중단됐어요')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: HEADLINE_TITLE })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI에게 물어보기' })).toBeInTheDocument();
  });

  it('분석 준비 중·장애를 서로 다른 안내로 구분한다', async () => {
    const user = await openWeek();

    await setScenario(user, /AI 준비 중/);
    expect(screen.getByText('이번 주 리포트를 준비하고 있어요')).toBeInTheDocument();

    await setScenario(user, /AI 장애/);
    expect(screen.getByText('지금은 리포트를 불러올 수 없어요')).toBeInTheDocument();
  });

  it('코칭 카드 표시만 끄면 우리 탭 리포트는 그대로 유지된다', async () => {
    const user = await openWeek();
    await setSettingFromHome(user, /코칭 카드 표시/);

    expect(screen.getByRole('heading', { name: HEADLINE_TITLE })).toBeInTheDocument();
    expect(screen.getByText('이번 주 통계')).toBeInTheDocument();
  });
});
