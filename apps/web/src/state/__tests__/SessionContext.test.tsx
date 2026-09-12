import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider, useSession } from '../SessionContext';
import { resetAllMockData } from '../../mocks/storage';

vi.mock('../../api/authApi');
// getProfile/updateProfile만 모킹한다 — toRealProfile은 순수 변환 함수라 실제 구현을 그대로 쓴다
// (모듈 전체를 자동 모킹하면 이것도 undefined를 반환하는 함수로 바뀐다).
vi.mock('../../api/profileApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/profileApi')>();
  return { ...actual, getProfile: vi.fn(), updateProfile: vi.fn() };
});

import * as authApi from '../../api/authApi';
import * as profileApi from '../../api/profileApi';

function Probe() {
  const s = useSession();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="initializing">{String(s.initializing)}</span>
      <span data-testid="initError">{String(s.initError)}</span>
      <span data-testid="realUser">{s.realUser?.nickname ?? ''}</span>
      <span data-testid="trialUser">{s.trialUser?.nickname ?? ''}</span>
      <span data-testid="loginResult"></span>
      <span data-testid="signupResult"></span>
      <span data-testid="signupMessage"></span>
      <button
        onClick={() => {
          void s.realLogIn({ email: 'a@a.com', password: 'test1234' }).then((r) => {
            document.querySelector('[data-testid="loginResult"]')!.textContent = r.kind;
          });
        }}
      >
        login
      </button>
      <button
        onClick={() => {
          void s.realSignUp({ email: 'a@a.com', password: 'test1234' }).then((r) => {
            document.querySelector('[data-testid="signupResult"]')!.textContent = r.kind;
            document.querySelector('[data-testid="signupMessage"]')!.textContent =
              'message' in r ? r.message : '';
          });
        }}
      >
        signup
      </button>
      <button
        onClick={() => {
          void s.retryRealSessionConfirmation().then((r) => {
            document.querySelector('[data-testid="loginResult"]')!.textContent = r.kind;
          });
        }}
      >
        retry-confirm
      </button>
      <button onClick={() => void s.retryInitialization()}>retry-init</button>
      <button onClick={() => void s.logOut()}>logout</button>
    </div>
  );
}

function renderSession() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </MemoryRouter>,
  );
}

const OK_PROFILE = {
  id: 'u1',
  email: 'a@a.com',
  nickname: '',
  avatar_emoji: null,
  couple_id: null,
  analysis_consent: false,
} as const;

beforeEach(() => {
  resetAllMockData();
  window.localStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  // 기본값: 서버에 로그인된 세션이 없다고 응답한다 — 로컬에 힌트가 없어도 마운트 시 항상
  // /me를 확인하므로(고침 4), 이 세션과 무관한 테스트가 매번 이 응답을 명시적으로 다룰 필요는
  // 없게 기본을 깔아 둔다. 실제로 필요한 테스트만 이 기본값을 덮어쓴다.
  vi.mocked(authApi.getSession).mockResolvedValue({ ok: true, data: { authenticated: false } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('SessionContext — 초기 세션 확인(서버 기준 복원)', () => {
  it('로컬 세션 기록이 없어도 서버 쿠키를 확인한다 — 로그인 안 된 상태면 anonymous', async () => {
    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    // 이전에는 "로컬 기록 없으면 호출 안 함"이 기대였지만, 이제는 로컬 기록이 없어도 서버
    // 쿠키 기준으로 확인해야 한다 — 호출은 반드시 일어난다.
    expect(authApi.getSession).toHaveBeenCalled();
  });

  it('로컬 세션 기록이 없어도 서버 쿠키가 유효하면 로그인 상태로 복원한다', async () => {
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준', avatar_emoji: '🐻' },
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    expect(screen.getByTestId('status').textContent).toBe('real-home');
    expect(screen.getByTestId('realUser').textContent).toBe('민준');
    expect(screen.getByTestId('trialUser').textContent).toBe(''); // mock trial은 여전히 비어 있다
  });

  it('real 세션 힌트가 있으면 /me로 확인하고, 인증돼 있으면 프로필까지 채운다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준', avatar_emoji: '🐻' },
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    expect(screen.getByTestId('status').textContent).toBe('real-home');
    expect(screen.getByTestId('realUser').textContent).toBe('민준');
  });

  it('/me가 인증 안 됐다고 하면 세션을 비운다(무한 로딩 없이 anonymous)', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({ ok: true, data: { authenticated: false } });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('/me 네트워크 오류는 initializing을 계속 true로 두고 initError만 세운다(일반 화면으로 새지 않음)', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({ ok: false });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initError').textContent).toBe('true'));
    // initError가 세워진 뒤에도 initializing은 여전히 true여야 한다 — SessionGate가 이 값으로
    // "확인 끝남"으로 착각해 일반 화면을 보여주면 안 되기 때문이다.
    expect(screen.getByTestId('initializing').textContent).toBe('true');
  });

  it('프로필 조회의 네트워크 오류도 initError(재시도 대상)로 다룬다 — 세션 만료와 구분', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({ kind: 'network-error' });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initError').textContent).toBe('true'));
    // initializing이 계속 true로 남아 있어야 한다 — SessionGate가 이 상태를 "확인 끝남"으로
    // 착각해 일반 화면(따라서 세션 만료 취급의 anonymous 화면 포함)을 보여주지 않게 하기 위해서.
    expect(screen.getByTestId('initializing').textContent).toBe('true');
  });

  it('초기화 실패 후 재시도하면 성공한다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValueOnce({ ok: false });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initError').textContent).toBe('true'));

    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });

    await act(async () => {
      screen.getByText('retry-init').click();
    });

    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    expect(screen.getByTestId('initError').textContent).toBe('false');
    expect(screen.getByTestId('status').textContent).toBe('real-home');
  });
});

describe('SessionContext — 로그인 성공 판정(쿠키·프로필까지 확인)', () => {
  it('로그인 POST 성공 후 /me 확인에 실패하면 완료로 보지 않는다(이메일을 id로 대신 쓰지 않음)', async () => {
    vi.mocked(authApi.logIn).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
    // 마운트 시점 확인(로컬 힌트 없음)은 정상적으로 "로그인 안 됨"으로 끝나고, 로그인 버튼을
    // 누른 뒤의 확인 호출부터 /me 자체가 실패한다.
    vi.mocked(authApi.getSession)
      .mockResolvedValueOnce({ ok: true, data: { authenticated: false } })
      .mockResolvedValue({ ok: false });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('login').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('loginResult').textContent).toBe('confirmation-failed'),
    );
    // 완료로 처리되지 않았다 — 세션이 만들어지지 않았어야 한다(이메일을 userId로 대신 넣지 않음).
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(screen.getByTestId('realUser').textContent).toBe('');
  });

  it('로그인 POST 성공 후 /me가 authenticated:false면 완료로 보지 않는다(쿠키 미적용)', async () => {
    vi.mocked(authApi.logIn).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
    vi.mocked(authApi.getSession).mockResolvedValue({ ok: true, data: { authenticated: false } });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('login').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('loginResult').textContent).toBe('cookie-not-applied'),
    );
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('로그인·쿠키 확인은 성공했지만 프로필 조회가 실패하면 완료로 보지 않고, 재시도해도 로그인 POST를 반복하지 않는다', async () => {
    vi.mocked(authApi.logIn).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
    // 마운트 시점 확인은 "로그인 안 됨"으로 빨리 끝내고(프로필 조회 자체를 안 함), 로그인 버튼을
    // 누른 뒤부터는 인증됨으로 응답한다 — 그래야 실패하는 첫 getProfile 호출이 마운트가 아니라
    // 로그인 확인에서 소비된다.
    vi.mocked(authApi.getSession)
      .mockResolvedValueOnce({ ok: true, data: { authenticated: false } })
      .mockResolvedValue({ ok: true, data: { authenticated: true, userId: 'u1' } });
    vi.mocked(profileApi.getProfile).mockResolvedValueOnce({ kind: 'network-error' });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('login').click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('loginResult').textContent).toBe('confirmation-failed'),
    );
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(authApi.logIn).toHaveBeenCalledTimes(1);

    // 재시도 — 프로필 조회가 이번엔 성공한다고 가정.
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    await act(async () => {
      screen.getByText('retry-confirm').click();
    });
    await waitFor(() => expect(screen.getByTestId('loginResult').textContent).toBe('ok'));
    expect(screen.getByTestId('status').textContent).toBe('real-home');
    // 로그인 POST는 여전히 처음 한 번만 — 재시도가 반복 호출하지 않았다.
    expect(authApi.logIn).toHaveBeenCalledTimes(1);
  });
});

describe('SessionContext — 가입 오류 안내 구분(realSignUp)', () => {
  async function clickSignUp() {
    await act(async () => {
      screen.getByText('signup').click();
    });
  }

  it('403 origin-not-allowed는 "이메일·비밀번호 확인" 문구가 아니라 접속 주소·서버 설정 확인 안내로 구분한다', async () => {
    vi.mocked(authApi.signUp).mockResolvedValue({
      kind: 'rejected',
      status: 403,
      error: 'origin-not-allowed',
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    await clickSignUp();

    expect(screen.getByTestId('signupResult').textContent).toBe('origin-not-allowed');
    const message = screen.getByTestId('signupMessage').textContent ?? '';
    expect(message).not.toMatch(/이메일과 비밀번호를 확인/);
    expect(message).toMatch(/접속 주소|서버 설정/);
  });

  it('500대 서버 오류는 "이메일·비밀번호 확인" 문구가 아니라 서버 처리 오류로 구분한다', async () => {
    vi.mocked(authApi.signUp).mockResolvedValue({
      kind: 'rejected',
      status: 500,
      error: 'internal-error',
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    await clickSignUp();

    expect(screen.getByTestId('signupResult').textContent).toBe('server-error');
    const message = screen.getByTestId('signupMessage').textContent ?? '';
    expect(message).not.toMatch(/이메일과 비밀번호를 확인/);
    expect(message).toMatch(/서버/);
  });

  it('503도 500과 같은 계열로 서버 오류로 구분한다', async () => {
    vi.mocked(authApi.signUp).mockResolvedValue({
      kind: 'rejected',
      status: 503,
      error: 'unavailable',
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    await clickSignUp();

    expect(screen.getByTestId('signupResult').textContent).toBe('server-error');
  });

  it('400 signup-rejected(중복 이메일 등)는 계정 존재 여부를 노출하지 않고 여전히 "이메일·비밀번호 확인" 문구로 뭉뚱그린다', async () => {
    vi.mocked(authApi.signUp).mockResolvedValue({
      kind: 'rejected',
      status: 400,
      error: 'signup-rejected',
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    await clickSignUp();

    expect(screen.getByTestId('signupResult').textContent).toBe('rejected');
    expect(screen.getByTestId('signupMessage').textContent).toMatch(/이메일과 비밀번호를 확인/);
  });

  it('429·202·네트워크 오류의 기존 구분은 그대로 유지된다', async () => {
    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));

    vi.mocked(authApi.signUp).mockResolvedValue({ kind: 'rate-limited' });
    await clickSignUp();
    expect(screen.getByTestId('signupResult').textContent).toBe('rate-limited');

    vi.mocked(authApi.signUp).mockResolvedValue({
      kind: 'unknown',
      status: 202,
      message: '결과를 확인하지 못했습니다.',
    });
    await clickSignUp();
    // 미확정 결과 — 성공(ok)도, 확정 실패(rejected)도 아닌 별도 종류로 남는다.
    expect(screen.getByTestId('signupResult').textContent).toBe('unknown');

    vi.mocked(authApi.signUp).mockResolvedValue({ kind: 'network-error' });
    await clickSignUp();
    expect(screen.getByTestId('signupResult').textContent).toBe('network-error');
  });
});

describe('SessionContext — 로그아웃 실패 처리', () => {
  it('로그아웃 500은 완료로 처리하지 않는다(로컬 세션 유지, 시작 화면으로 이동 안 함)', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    vi.mocked(authApi.logOut).mockResolvedValue({
      kind: 'rejected',
      status: 500,
      error: 'internal',
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('real-home'); // 그대로 유지
    expect(window.alert).toHaveBeenCalled();
  });

  it('로그아웃 403은 완료로 처리하지 않는다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'rejected', status: 403, error: 'forbidden' });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('real-home');
  });

  it('로그아웃 429(rate-limited)는 완료로 처리하지 않는다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'rate-limited' });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('real-home');
  });

  it('로그아웃 결과 미확정(202 unknown)은 완료로 처리하지 않는다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'unknown', status: 202, message: '확인 중' });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('real-home');
  });

  it('로그아웃 네트워크 오류는 완료로 처리하지 않는다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'network-error' });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('real-home');
  });

  it('예상 밖 200 응답은 완료로 처리하지 않는다(204만 정상 성공)', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    // kind는 'ok'지만 상태 코드가 204가 아니다 — API 계약(204-only)과 다른 예상 밖 응답.
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'ok', data: undefined, status: 200 });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('real-home'); // 그대로 유지
    expect(window.alert).toHaveBeenCalled();
  });

  it('정상 204는 로그아웃을 완료한다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'ok', data: undefined, status: 204 });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('이미 만료된 세션의 401은 로그아웃 완료로 처리한다', async () => {
    window.localStorage.setItem(
      'deardarling:mock:v1:trial:session',
      JSON.stringify({ kind: 'real', userId: 'u1' }),
    );
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '민준' },
    });
    vi.mocked(authApi.logOut).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });
});

describe('SessionContext — 실제 계정과 mock trial 분리', () => {
  it('real 로그인 성공은 trialUser를 절대 채우지 않는다', async () => {
    vi.mocked(authApi.logIn).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
    vi.mocked(authApi.getSession).mockResolvedValue({
      ok: true,
      data: { authenticated: true, userId: 'u1' },
    });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: OK_PROFILE,
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    // 마운트 시점에 이미 서버 세션이 있다고 응답했으므로(위 mock), 여기서 real-incomplete로
    // 복원돼 있을 수 있다 — 이 테스트의 핵심은 "trialUser는 절대 안 채워진다"는 것.
    await act(async () => {
      screen.getByText('login').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('real-incomplete');
    expect(screen.getByTestId('trialUser').textContent).toBe('');
  });
});

describe('SessionContext — 세대 가드', () => {
  it('로그아웃 뒤 늦게 도착한 로그인 응답은 상태를 되돌리지 않는다', async () => {
    let resolveLogin!: (v: Awaited<ReturnType<typeof authApi.logIn>>) => void;
    vi.mocked(authApi.logIn).mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'ok', data: undefined, status: 204 });
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: OK_PROFILE,
    });

    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('login').click(); // 응답 대기 중(아직 안 옴)
    });
    await act(async () => {
      screen.getByText('logout').click(); // 로그인 응답이 오기 전에 로그아웃(세대가 올라감)
    });
    expect(screen.getByTestId('status').textContent).toBe('anonymous');

    await act(async () => {
      resolveLogin({ kind: 'ok', data: { ok: true }, status: 200 }); // 늦게 도착
      await Promise.resolve();
      await Promise.resolve();
    });

    // 늦게 도착한 로그인 결과가 로그아웃 이후 상태를 되돌리면 안 된다.
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });
});
