import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/renderApp';
import {
  seedConnectedTrialCouple,
  seedPendingInvite,
  seedProfileCompleteTrialUser,
  seedReviewSession,
  seedTrialUser,
} from '../../../test/seed';
import { resetAllMockData, trialKey, readJSON } from '../../../mocks/storage';

vi.mock('../../../api/authApi');
// getProfile/updateProfile만 모킹한다 — toRealProfile은 순수 변환 함수라 실제 구현을 그대로 쓴다.
vi.mock('../../../api/profileApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/profileApi')>();
  return { ...actual, getProfile: vi.fn(), updateProfile: vi.fn() };
});

import * as authApi from '../../../api/authApi';
import * as profileApi from '../../../api/profileApi';

beforeEach(() => {
  // real 세션 힌트가 로컬에 없어도 서버 쿠키를 항상 확인한다(고침 4) — 기본은 "로그인 안 됨"
  // 으로 응답해, real 계정을 실제로 검증하는 테스트만 이 기본값을 각자 덮어쓴다.
  vi.mocked(authApi.getSession).mockResolvedValue({ ok: true, data: { authenticated: false } });
});

afterEach(() => {
  resetAllMockData();
  // SignUpScreen의 "인증 재개" 기록은 mock 네임스페이스 밖(deardarling:web:v1:*)이라
  // resetAllMockData가 못 지운다 — 테스트 간에 새지 않게 직접 지운다.
  window.localStorage.removeItem('deardarling:web:v1:pending-signup-email');
  vi.clearAllMocks();
});

/**
 * `/signup`·`/login`·`/reset`은 이제 실제 API(모킹)로만 동작한다 — mock trial 체험 계정은
 * 더 이상 공개 UI로는 만들 수 없고, DevPanel에서만 쓸 수 있다(SessionContext 참고). 그래서
 * "가입 → 프로필" 흐름과 "체험(trial) 프로필 → 연결" 흐름을 분리해 각각 검증한다.
 */
describe('실제 계정 — 가입 → 이메일 인증 → 프로필', () => {
  it('가입 → 코드 확인 → 로그인 화면 안내까지 간다(자동 로그인하지 않는다)', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.signUp).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
    vi.mocked(authApi.confirmSignUp).mockResolvedValue({
      kind: 'ok',
      data: { ok: true },
      status: 200,
    });

    renderApp({ route: '/' });
    await user.click(await screen.findByRole('button', { name: '함께 시작하기' }));
    expect(await screen.findByRole('button', { name: '가입하고 계속하기' })).toBeInTheDocument();

    // 형식 오류 안내
    await user.type(screen.getByLabelText('이메일'), 'nope');
    await user.type(screen.getByLabelText('비밀번호'), 'short');
    await user.type(screen.getByLabelText('비밀번호 확인'), 'short');
    await user.click(screen.getByRole('button', { name: '가입하고 계속하기' }));
    expect(screen.getByText(/이메일 형식이 올바르지 않아요/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('이메일'));
    await user.type(screen.getByLabelText('이메일'), 'a@a.com');
    await user.clear(screen.getByLabelText('비밀번호'));
    await user.type(screen.getByLabelText('비밀번호'), 'test1234');
    await user.clear(screen.getByLabelText('비밀번호 확인'));
    await user.type(screen.getByLabelText('비밀번호 확인'), 'test1234');
    await user.click(screen.getByRole('button', { name: '가입하고 계속하기' }));

    // 이메일 인증 코드 단계
    const code = await screen.findByLabelText('인증 코드');
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: '확인' }));

    // 인증이 끝나면 자동 로그인하지 않고 로그인 화면에서 직접 로그인하게 안내한다.
    await waitFor(() => expect(screen.getByText(/이메일 인증이 완료됐어요/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument();
    expect(authApi.logIn).not.toHaveBeenCalled();
  });

  it('비밀번호는 어떤 저장소 값에도 남지 않는다', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.signUp).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });

    renderApp({ route: '/signup' });
    const pw = await screen.findByLabelText('비밀번호');
    expect(pw).toHaveAttribute('type', 'password');
    await user.type(screen.getByLabelText('이메일'), 'x@x.com');
    await user.type(pw, 'zebra9pw');
    await user.type(screen.getByLabelText('비밀번호 확인'), 'zebra9pw');
    await user.click(screen.getByRole('button', { name: '가입하고 계속하기' }));
    await screen.findByLabelText('인증 코드');

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)!;
      expect(window.localStorage.getItem(key) ?? '').not.toContain('zebra9pw');
    }
  });

  it('비밀번호 찾기 — 코드 요청 뒤 코드+새 비밀번호 입력 단계로 넘어간다', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({
      kind: 'ok',
      data: { ok: true },
      status: 200,
    });

    renderApp({ route: '/reset' });
    await user.type(await screen.findByLabelText('이메일'), 'ghost@a.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 받기' }));

    expect(await screen.findByLabelText('인증 코드')).toBeInTheDocument();
    expect(await screen.findByLabelText('새 비밀번호')).toBeInTheDocument();
  });

  it('가입 후 화면을 벗어났다 돌아와도 다시 가입하지 않고 인증 코드 입력을 이어간다', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('deardarling:web:v1:pending-signup-email', 'resume@a.com');
    vi.mocked(authApi.confirmSignUp).mockResolvedValue({
      kind: 'ok',
      data: { ok: true },
      status: 200,
    });

    renderApp({ route: '/signup' });
    // 회원가입을 다시 호출하지 않고 곧장 코드 입력 화면으로 들어간다.
    expect(await screen.findByLabelText('인증 코드')).toBeInTheDocument();
    expect(authApi.signUp).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('인증 코드'), '000000');
    await user.click(screen.getByRole('button', { name: '확인' }));

    // 비밀번호가 메모리에 없으므로(새로고침으로 재개) 자동 로그인을 시도하지 않고 로그인
    // 화면으로 안내한다.
    await waitFor(() => expect(screen.getByText(/로그인해 주세요/)).toBeInTheDocument());
    expect(authApi.logIn).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('deardarling:web:v1:pending-signup-email')).toBeNull();
  });

  it('인증 코드 확인 응답이 늦게 도착하기 전에 "다른 이메일로 다시 시작"을 누르면 이전 계정으로 자동 로그인하지 않는다', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('deardarling:web:v1:pending-signup-email', 'old@a.com');
    let resolveConfirm!: (v: Awaited<ReturnType<typeof authApi.confirmSignUp>>) => void;
    vi.mocked(authApi.confirmSignUp).mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );

    renderApp({ route: '/signup' });
    // 새로고침 재개 — 곧장 코드 입력 화면.
    await screen.findByLabelText('인증 코드');
    await user.type(screen.getByLabelText('인증 코드'), '000000');
    await user.click(screen.getByRole('button', { name: '확인' })); // 응답 대기 중(아직 안 옴)

    // 응답이 오기 전에 다른 이메일로 다시 시작한다.
    await user.click(screen.getByRole('button', { name: '다른 이메일로 다시 시작' }));
    expect(await screen.findByRole('button', { name: '가입하고 계속하기' })).toBeInTheDocument();

    // 이전 화면(old@a.com)에 대한 확인 응답이 이제야 늦게 도착한다.
    await resolveConfirm({ kind: 'ok', data: { ok: true }, status: 200 });
    await Promise.resolve();
    await Promise.resolve();

    // 늦게 도착한 응답이 자동 로그인·화면 이동을 일으키면 안 된다 — 여전히 새 가입 폼이다.
    expect(screen.getByRole('button', { name: '가입하고 계속하기' })).toBeInTheDocument();
    expect(authApi.logIn).not.toHaveBeenCalled();
    // 인증 재개 기록도 되살아나면 안 된다 — "다시 시작"으로 이미 지워졌어야 한다.
    expect(window.localStorage.getItem('deardarling:web:v1:pending-signup-email')).toBeNull();
  });

  it('비밀번호가 메모리에 있는 상태로 인증을 마쳐도 로그인 API를 호출하지 않고 로그인 화면으로 보낸다', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.signUp).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
    vi.mocked(authApi.confirmSignUp).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });

    renderApp({ route: '/' });
    await user.click(await screen.findByRole('button', { name: '함께 시작하기' }));
    expect(await screen.findByRole('button', { name: '가입하고 계속하기' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('이메일'), 'new@a.com');
    await user.type(screen.getByLabelText('비밀번호'), 'test1234');
    await user.type(screen.getByLabelText('비밀번호 확인'), 'test1234');
    await user.click(screen.getByRole('button', { name: '가입하고 계속하기' }));

    const code = await screen.findByLabelText('인증 코드');
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: '확인' }));

    // 비밀번호가 메모리에 남아 있어도(신규 가입 직후) 자동 로그인은 절대 하지 않는다 — 늦게
    // 도착하는 로그인 응답이 실제로 브라우저에 쿠키를 남겨, "다시 시작" 뒤 새로고침 시 방금
    // 버린 계정 세션이 복원되는 문제를 아예 만들지 않기 위해서다.
    await waitFor(() => expect(screen.getByText(/이메일 인증이 완료됐어요/)).toBeInTheDocument());
    expect(authApi.logIn).not.toHaveBeenCalled();
  });

  it('인증 코드 확인 응답을 기다리는 중 화면을 벗어나도(언마운트) 늦게 도착한 응답이 아무 효과를 내지 않는다', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('deardarling:web:v1:pending-signup-email', 'old@a.com');
    let resolveConfirm!: (v: Awaited<ReturnType<typeof authApi.confirmSignUp>>) => void;
    vi.mocked(authApi.confirmSignUp).mockReturnValue(
      new Promise((resolve) => {
        resolveConfirm = resolve;
      }),
    );

    const rendered = renderApp({ route: '/signup' });
    await screen.findByLabelText('인증 코드');
    await user.type(screen.getByLabelText('인증 코드'), '000000');
    await user.click(screen.getByRole('button', { name: '확인' })); // 응답 대기 중(아직 안 옴)

    // 응답이 오기 전에 화면을 완전히 떠난다(언마운트).
    rendered.unmount();

    // 이제야 늦게 도착한 응답 — 언마운트된 화면에서 setState 경고 없이 조용히 무시돼야 한다.
    await resolveConfirm({ kind: 'ok', data: { ok: true }, status: 200 });
    await Promise.resolve();
    await Promise.resolve();

    expect(authApi.logIn).not.toHaveBeenCalled();
  });

  it('가입·로그인 화면에는 더 이상 "가상 체험" 배너가 보이지 않는다(실제 계정 화면)', async () => {
    renderApp({ route: '/signup' });
    expect(await screen.findByText(/예: test1234/)).toBeInTheDocument();
    expect(screen.queryByText(/화면 검토용 가상 체험/)).not.toBeInTheDocument();
  });
});

describe('초기 세션 확인 실패 — 재시도 화면', () => {
  it('서버 확인이 실패하면 일반 화면 대신 재시도 화면을 보여주고, 재시도하면 복구된다', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      trialKey('session'),
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValueOnce({ ok: false });

    renderApp({ route: '/' });

    expect(await screen.findByText('로그인 상태를 확인하지 못했습니다.')).toBeInTheDocument();
    // 실패 중엔 시작 화면 등 다른 화면이 보이면 안 된다.
    expect(screen.queryByRole('button', { name: '함께 시작하기' })).not.toBeInTheDocument();

    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: {
        id: 'u1',
        email: 'a@a.com',
        nickname: '민준',
        avatar_emoji: '🐻',
        couple_id: null,
        analysis_consent: false,
      },
    });
    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(await screen.findByText(/준비 중이에요/)).toBeInTheDocument(); // /real/home
  });
});

describe('로그인 상태에서 비밀번호 재설정', () => {
  it('본인 계정 비밀번호를 바꾼 뒤 서버 세션이 무효화되면 /real/home이 아니라 로그인 화면으로 안내한다', async () => {
    const user = userEvent.setup();
    // 이미 로그인된 실제 계정으로 시작한다.
    vi.mocked(authApi.getSession)
      .mockResolvedValueOnce({ ok: true, data: { authenticated: true, userId: 'u1' } })
      // 비밀번호 재설정 확인 뒤 재확인 호출 — 서버가 세션을 무효화했다고 응답한다.
      .mockResolvedValueOnce({ ok: true, data: { authenticated: false } });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: {
        id: 'u1',
        email: 'a@a.com',
        nickname: '민준',
        avatar_emoji: '🐻',
        couple_id: null,
        analysis_consent: false,
      },
    });
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({
      kind: 'ok',
      data: { ok: true },
      status: 200,
    });
    vi.mocked(authApi.confirmForgotPassword).mockResolvedValue({
      kind: 'ok',
      data: { status: 'confirmed' },
      status: 200,
    });

    renderApp({ route: '/reset', session: { kind: 'real', userId: 'u1' } });

    // 로그인된 상태에서도 /reset 화면 자체는 그대로 볼 수 있다.
    await user.type(await screen.findByLabelText('이메일'), 'a@a.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 받기' }));

    await user.type(await screen.findByLabelText('인증 코드'), '123456');
    await user.type(screen.getByLabelText('새 비밀번호'), 'newpass12');
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }));

    // 서버가 세션이 이제 없다고 확인해 줬으므로(재확인), 로컬 로그인 상태가 정리되고
    // 가드에 의해 /real/home으로 되돌아가지 않고 로그인 화면이 보여야 한다.
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument();
    expect(screen.queryByText(/준비 중이에요/)).not.toBeInTheDocument();
  });

  it('대소문자·앞뒤 공백이 다른 본인 이메일로 재설정해도 같은 계정으로 인식해 세션을 재확인한다', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getSession)
      .mockResolvedValueOnce({ ok: true, data: { authenticated: true, userId: 'u1' } })
      // 재확인 호출 — 서버가 세션을 무효화했다고 응답한다.
      .mockResolvedValueOnce({ ok: true, data: { authenticated: false } });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: {
        id: 'u1',
        email: 'a@a.com', // 로그인된 계정의 이메일은 소문자·공백 없이 저장돼 있다.
        nickname: '민준',
        avatar_emoji: '🐻',
        couple_id: null,
        analysis_consent: false,
      },
    });
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({
      kind: 'ok',
      data: { ok: true },
      status: 200,
    });
    vi.mocked(authApi.confirmForgotPassword).mockResolvedValue({
      kind: 'ok',
      data: { status: 'confirmed' },
      status: 200,
    });

    renderApp({ route: '/reset', session: { kind: 'real', userId: 'u1' } });

    // 대소문자가 다르고 앞뒤 공백도 있는 채로 같은(본인) 이메일을 입력한다.
    await user.type(await screen.findByLabelText('이메일'), '  A@A.com  ');
    await user.click(screen.getByRole('button', { name: '재설정 코드 받기' }));

    await user.type(await screen.findByLabelText('인증 코드'), '123456');
    await user.type(screen.getByLabelText('새 비밀번호'), 'newpass12');
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }));

    // 정규화 없이 문자열을 그대로 비교했다면 "다른 계정"으로 오인해 재확인을 건너뛰었을
    // 것이다 — 여기서는 같은 계정으로 인식해 세션을 재확인하고, 무효화됐으므로 로그인
    // 화면으로 안내해야 한다(가드에 의해 /real/home으로 되돌아가지 않는다).
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument();
    expect(screen.queryByText(/준비 중이에요/)).not.toBeInTheDocument();
    expect(authApi.getSession).toHaveBeenCalledTimes(2);
  });

  it('다른 계정의 비밀번호를 재설정한 경우에는 내 로그인 상태를 건드리지 않는다', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: {
        id: 'u1',
        email: 'me@a.com',
        nickname: '민준',
        avatar_emoji: '🐻',
        couple_id: null,
        analysis_consent: false,
      },
    });
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({
      kind: 'ok',
      data: { ok: true },
      status: 200,
    });
    vi.mocked(authApi.confirmForgotPassword).mockResolvedValue({
      kind: 'ok',
      data: { status: 'confirmed' },
      status: 200,
    });

    renderApp({ route: '/reset', session: { kind: 'real', userId: 'u1' } });

    // 로그인한 계정(me@a.com)이 아니라 다른 이메일(other@a.com)의 비밀번호를 재설정한다.
    await user.type(await screen.findByLabelText('이메일'), 'other@a.com');
    await user.click(screen.getByRole('button', { name: '재설정 코드 받기' }));
    await user.type(await screen.findByLabelText('인증 코드'), '123456');
    await user.type(screen.getByLabelText('새 비밀번호'), 'newpass12');
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }));

    // /login으로 이동을 시도하지만, 내 세션은 여전히 유효한 real 세션이라 RedirectIfAuthed가
    // /real/home으로 되돌린다 — 즉 다른 계정 재설정이 나를 로그아웃시키지 않았다는 뜻이다.
    expect(await screen.findByText(/준비 중이에요/)).toBeInTheDocument();
    // 마운트 시 1번(초기 세션 확인) 외에는 재확인 호출이 더 없어야 한다(다른 계정이라 재확인
    // 자체를 하지 않는다).
    expect(authApi.getSession).toHaveBeenCalledTimes(1);
  });
});

describe('체험(mock) 계정 — 프로필 → 연결 진입', () => {
  it('체험 세션에서 프로필을 정하면 연결 허브로 간다(트라이얼은 여전히 mock 그대로)', async () => {
    const user = userEvent.setup();
    const trial = seedTrialUser({ nickname: '' });
    renderApp({ route: '/onboarding/profile', session: { kind: 'trial', userId: trial.id } });

    const nickname = await screen.findByLabelText('닉네임');
    await user.type(nickname, '테스트');
    await user.click(screen.getByRole('button', { name: '저장하고 계속하기' }));

    expect(await screen.findByText('연인 연결')).toBeInTheDocument();
    // 실제 API는 전혀 호출되지 않는다 — mock trial과 완전히 분리돼 있다.
    expect(profileApi.updateProfile).not.toHaveBeenCalled();
  });
});

describe('단계 강제 (직접 URL / 새로고침)', () => {
  it('닉네임이 없는 체험 세션은 /connect에서 프로필로 리다이렉트', async () => {
    const user = seedTrialUser({ nickname: '' });
    renderApp({ route: '/connect', session: { kind: 'trial', userId: user.id } });
    expect(await screen.findByLabelText('닉네임')).toBeInTheDocument();
  });

  it('프로필 완료·미연결 세션은 /app/home에서 연결 허브로 리다이렉트', async () => {
    const user = seedProfileCompleteTrialUser('테스트');
    renderApp({ route: '/app/home', session: { kind: 'trial', userId: user.id } });
    expect(await screen.findByText('연인 연결')).toBeInTheDocument();
  });

  it('연결된 체험 커플은 /에서 홈으로 리다이렉트', async () => {
    const { a } = seedConnectedTrialCouple();
    renderApp({ route: '/', session: { kind: 'trial', userId: a.id } });
    expect(await screen.findByText(/오늘의 우리/)).toBeInTheDocument();
  });

  it('익명은 /app/week·/connect에서 시작 화면으로', async () => {
    renderApp({ route: '/app/week' });
    expect(await screen.findByRole('button', { name: '함께 시작하기' })).toBeInTheDocument();
  });

  it('AI 동의를 건너뛴 상태로도 연결 허브에 머무를 수 있다(필수 아님)', async () => {
    const user = seedProfileCompleteTrialUser('테스트');
    renderApp({ route: '/connect', session: { kind: 'trial', userId: user.id } });
    expect(await screen.findByText('연인 연결')).toBeInTheDocument();
  });
});

describe('연인 연결', () => {
  it('코드 입력 → 상대 확인 → 연결하면 홈으로 간다', async () => {
    const u = userEvent.setup();
    const a = seedTrialUser({ nickname: '가온' });
    const b = seedProfileCompleteTrialUser('나린');
    seedPendingInvite(a);

    renderApp({ route: '/connect/join', session: { kind: 'trial', userId: b.id } });
    await u.type(screen.getByLabelText('초대 코드'), 'DD-SEED01');
    await u.click(screen.getByRole('button', { name: '확인' }));

    expect(await screen.findByText('가온')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '연결' }));

    expect(await screen.findByText(/오늘의 우리/)).toBeInTheDocument();
    // 양쪽이 같은 커플로 연결됨
    const users = readJSON<{ id: string; coupleId: string | null }[]>(trialKey('users'), []);
    const linked = users.filter((x) => x.coupleId);
    expect(linked).toHaveLength(2);
    expect(new Set(linked.map((x) => x.coupleId)).size).toBe(1);
  });

  it('잘못된·본인 코드는 안내를 보여준다', async () => {
    const u = userEvent.setup();
    const a = seedProfileCompleteTrialUser('가온');
    seedPendingInvite(a);

    renderApp({ route: '/connect/join', session: { kind: 'trial', userId: a.id } });
    await u.type(screen.getByLabelText('초대 코드'), 'DD-NOPExx');
    await u.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByText('유효하지 않은 코드예요.')).toBeInTheDocument();

    await u.clear(screen.getByLabelText('초대 코드'));
    await u.type(screen.getByLabelText('초대 코드'), 'DD-SEED01');
    await u.click(screen.getByRole('button', { name: '확인' }));
    expect(await screen.findByText('본인 코드예요.')).toBeInTheDocument();
  });
});

describe('검토 모드는 그대로', () => {
  it('review 세션은 온보딩을 건너뛰고 바로 홈, /connect는 홈으로 되돌린다', async () => {
    renderApp({ route: '/connect', session: seedReviewSession() });
    expect(await screen.findByText(/함께한 지/)).toBeInTheDocument();
  });

  it('시작 화면의 "예시 화면 둘러보기"로 검토 모드에 들어간다', async () => {
    const u = userEvent.setup();
    renderApp({ route: '/' });
    await u.click(await screen.findByRole('button', { name: /민준·서연 예시 화면 둘러보기/ }));
    await waitFor(() => expect(screen.getByText(/함께한 지/)).toBeInTheDocument());
  });
});
