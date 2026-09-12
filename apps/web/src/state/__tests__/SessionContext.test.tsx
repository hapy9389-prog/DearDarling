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
vi.mock('../../api/inviteApi');
// toRealCouple도 순수 변환 함수라 그대로 쓴다.
vi.mock('../../api/coupleApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/coupleApi')>();
  return { ...actual, getCouple: vi.fn(), updateCouple: vi.fn() };
});
vi.mock('../../api/consentApi');

import * as authApi from '../../api/authApi';
import * as profileApi from '../../api/profileApi';
import * as inviteApi from '../../api/inviteApi';
import * as coupleApi from '../../api/coupleApi';
import * as consentApi from '../../api/consentApi';

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
      <span data-testid="analysisConsent">{String(s.realUser?.analysisConsent ?? '')}</span>
      <span data-testid="coupleId">{s.realUser?.coupleId ?? ''}</span>
      <span data-testid="inviteResult"></span>
      <span data-testid="inviteCode"></span>
      <span data-testid="previewResult"></span>
      <span data-testid="acceptResult"></span>
      <span data-testid="acceptCoupleId"></span>
      <span data-testid="revokeResult"></span>
      <span data-testid="coupleResult"></span>
      <span data-testid="consentResult"></span>
      <span data-testid="refreshResult"></span>
      <button
        onClick={() => {
          void s.refreshRealProfile().then((r) => {
            document.querySelector('[data-testid="refreshResult"]')!.textContent = r.kind;
          });
        }}
      >
        refresh-profile
      </button>
      <button
        onClick={() => {
          void s.realCreateInvite().then((r) => {
            document.querySelector('[data-testid="inviteResult"]')!.textContent = r.kind;
            document.querySelector('[data-testid="inviteCode"]')!.textContent =
              'code' in r ? r.code : '';
          });
        }}
      >
        create-invite
      </button>
      <button
        onClick={() => {
          void s.realPreviewInvite('DD-000000').then((r) => {
            document.querySelector('[data-testid="previewResult"]')!.textContent =
              'reason' in r ? r.reason : r.kind;
          });
        }}
      >
        preview-invite
      </button>
      <button
        onClick={() => {
          void s.realAcceptInvite({ code: 'DD-000000', relationshipStartDate: null }).then((r) => {
            document.querySelector('[data-testid="acceptResult"]')!.textContent =
              'reason' in r ? r.reason : r.kind;
            document.querySelector('[data-testid="acceptCoupleId"]')!.textContent =
              'coupleId' in r ? r.coupleId : '';
          });
        }}
      >
        accept-invite
      </button>
      <button
        onClick={() => {
          void s.realRevokeInvite('DD-000000').then((r) => {
            document.querySelector('[data-testid="revokeResult"]')!.textContent = r.kind;
          });
        }}
      >
        revoke-invite
      </button>
      <button
        onClick={() => {
          void s.realGetCouple().then((r) => {
            document.querySelector('[data-testid="coupleResult"]')!.textContent = r.kind;
          });
        }}
      >
        get-couple
      </button>
      <button
        onClick={() => {
          void s.realSetConsent(true).then((r) => {
            document.querySelector('[data-testid="consentResult"]')!.textContent = r.kind;
          });
        }}
      >
        set-consent-true
      </button>
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

describe('SessionContext — 초대·커플·동의 연결', () => {
  async function signInAsRealUser() {
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
    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));
  }

  describe('realCreateInvite', () => {
    it('성공 시 코드를 그대로 전달한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.createInvite).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: {
          id: 'inv1',
          code: 'DD-ABCDEF',
          inviter_user_id: 'u1',
          accepted_by_user_id: null,
          status: 'pending',
          created_at: '2025-01-01T00:00:00Z',
          expires_at: '2025-01-04T00:00:00Z',
          accepted_at: null,
        },
      });
      await act(async () => {
        screen.getByText('create-invite').click();
      });
      expect(screen.getByTestId('inviteResult').textContent).toBe('ok');
      expect(screen.getByTestId('inviteCode').textContent).toBe('DD-ABCDEF');
    });

    it('409 inviter-already-connected는 이미 연결됨으로 구분한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.createInvite).mockResolvedValue({
        kind: 'rejected',
        status: 409,
        error: 'inviter-already-connected',
      });
      await act(async () => {
        screen.getByText('create-invite').click();
      });
      expect(screen.getByTestId('inviteResult').textContent).toBe('already-connected');
    });
  });

  describe('realPreviewInvite', () => {
    it('성공하면 상대 닉네임을 그대로 전달한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.previewInvite).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { inviter_nickname: '서연', inviter_avatar_emoji: '🐥' },
      });
      await act(async () => {
        screen.getByText('preview-invite').click();
      });
      expect(screen.getByTestId('previewResult').textContent).toBe('ok');
    });

    it.each(['self', 'expired', 'accepter-already-connected'] as const)(
      '409 %s는 그 사유 그대로 전달한다',
      async (reason) => {
        await signInAsRealUser();
        vi.mocked(inviteApi.previewInvite).mockResolvedValue({
          kind: 'rejected',
          status: 409,
          error: reason,
        });
        await act(async () => {
          screen.getByText('preview-invite').click();
        });
        expect(screen.getByTestId('previewResult').textContent).toBe(reason);
      },
    );

    it('429는 rate-limited로 구분한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.previewInvite).mockResolvedValue({ kind: 'rate-limited' });
      await act(async () => {
        screen.getByText('preview-invite').click();
      });
      expect(screen.getByTestId('previewResult').textContent).toBe('rate-limited');
    });
  });

  describe('realAcceptInvite — 수락 확정 성공과 이후 조회 실패를 구분', () => {
    it('수락 성공(200) + 프로필 재조회 성공 → ok, realUser.coupleId 반영', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { coupleId: 'couple1' },
      });
      vi.mocked(profileApi.getProfile).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '민준', couple_id: 'couple1' },
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('ok');
      expect(screen.getByTestId('acceptCoupleId').textContent).toBe('couple1');
      expect(screen.getByTestId('coupleId').textContent).toBe('couple1');
      expect(screen.getByTestId('status').textContent).toBe('real-connected');
    });

    it('수락 성공(200) + 프로필 재조회 실패 → "수락 실패"가 아니라 connected-refresh-failed로 구분한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { coupleId: 'couple1' },
      });
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({ kind: 'network-error' });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      // 'rejected'나 'invite-rejected'가 아니라 연결 자체는 확정 성공했음을 나타내는 별도 종류다.
      expect(screen.getByTestId('acceptResult').textContent).toBe('connected-refresh-failed');
      expect(screen.getByTestId('acceptCoupleId').textContent).toBe('couple1');
    });

    it('수락 요청 자체가 네트워크 오류여도(서버 처리는 됐지만 응답만 유실됐을 수 있음) 재조회로 연결을 확인하면 ok로 판정하고, 수락 POST를 반복하지 않는다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({ kind: 'network-error' });
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '민준', couple_id: 'couple1' },
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('ok');
      expect(screen.getByTestId('acceptCoupleId').textContent).toBe('couple1');
      expect(inviteApi.acceptInvite).toHaveBeenCalledTimes(1); // 네트워크 오류라고 POST를 다시 보내지 않았다
    });

    it('수락 요청이 네트워크 오류이고 재조회도 실패하면 unconfirmed로 남긴다(성공도 실패도 아님)', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({ kind: 'network-error' });
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({ kind: 'network-error' });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('unconfirmed');
      expect(inviteApi.acceptInvite).toHaveBeenCalledTimes(1);
    });

    it('수락 결과 미확정(202) 뒤 재조회에서 실제로는 연결돼 있었다면 ok로 판정하고, 수락 POST를 반복하지 않는다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'unknown',
        status: 202,
        message: '확인 중',
      });
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '민준', couple_id: 'couple1' },
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('ok');
      expect(screen.getByTestId('acceptCoupleId').textContent).toBe('couple1');
      expect(inviteApi.acceptInvite).toHaveBeenCalledTimes(1); // POST를 반복하지 않았다
    });

    it('수락 결과 미확정(202) 뒤 재조회에서도 연결이 확인되지 않으면 unconfirmed로 남기고, 수락 POST를 반복하지 않는다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'unknown',
        status: 202,
        message: '확인 중',
      });
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '민준', couple_id: null },
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('unconfirmed');
      expect(inviteApi.acceptInvite).toHaveBeenCalledTimes(1);
    });

    it('409 사유는 invite-rejected로 그대로 전달한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'rejected',
        status: 409,
        error: 'expired',
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('expired');
    });

    it('400 invalid-relationship-start-date는 invalid-date로 구분한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'rejected',
        status: 400,
        error: 'invalid-relationship-start-date',
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('invalid-date');
    });
  });

  describe('초대 수락 기록의 계정별 영속화(재진입·새로고침 복원용)', () => {
    function pendingKey(userId: string): string {
      return `deardarling:web:v1:pending-invite-accept:${userId}`;
    }

    it('요청을 보내기 전에 먼저 기록하고(accepting), 비밀번호·인증 코드·토큰은 담지 않는다', async () => {
      await signInAsRealUser();
      let resolveAccept!: (v: Awaited<ReturnType<typeof inviteApi.acceptInvite>>) => void;
      vi.mocked(inviteApi.acceptInvite).mockReturnValue(
        new Promise((resolve) => {
          resolveAccept = resolve;
        }),
      );

      act(() => {
        screen.getByText('accept-invite').click();
      });
      await waitFor(() => expect(window.localStorage.getItem(pendingKey('u1'))).not.toBeNull());
      const stored = JSON.parse(window.localStorage.getItem(pendingKey('u1'))!);
      expect(stored).toEqual({ code: 'DD-000000', relationshipStartDate: null, phase: 'accepting' });
      expect(JSON.stringify(stored)).not.toMatch(/password|token|cookie/i);

      // 응답이 아직 안 왔어도 기록은 이미 남아 있다 — 정리한다.
      resolveAccept({ kind: 'ok', status: 200, data: { coupleId: 'couple1' } });
      await waitFor(() => expect(screen.getByTestId('acceptResult').textContent).toBe('ok'));
    });

    it('연결 확인(ok) 시 기록을 정리한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { coupleId: 'couple1' },
      });
      vi.mocked(profileApi.getProfile).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '민준', couple_id: 'couple1' },
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('ok');
      expect(window.localStorage.getItem(pendingKey('u1'))).toBeNull();
    });

    it('연결은 확정 성공했지만 조회만 실패하면(connected-refresh-failed) 기록을 유지한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { coupleId: 'couple1' },
      });
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({ kind: 'network-error' });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('connected-refresh-failed');
      const stored = JSON.parse(window.localStorage.getItem(pendingKey('u1'))!);
      expect(stored.phase).toBe('connected-refresh-failed');
      expect(stored.code).toBe('DD-000000');
    });

    it('수락 결과가 미확정(unconfirmed)이면 기록을 유지한다 — 조회 실패가 반복돼도 확정 실패로 바뀌지 않는다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({ kind: 'network-error' });
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({ kind: 'network-error' });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('unconfirmed');
      expect(JSON.parse(window.localStorage.getItem(pendingKey('u1'))!).phase).toBe('unconfirmed');
    });

    it('서버가 확정 거절하면(409) 기록을 정리해 새 시도를 허용한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'rejected',
        status: 409,
        error: 'expired',
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('expired');
      expect(window.localStorage.getItem(pendingKey('u1'))).toBeNull();
    });

    it('다른 계정으로 전환한 뒤 도착한 이전 계정의 늦은 응답도 그 계정 자신의 기록에만 반영되고, 새 계정에는 영향이 없다', async () => {
      // u1로 로그인해 수락을 시작한다(응답 지연).
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
      renderSession();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

      let resolveAccept!: (v: Awaited<ReturnType<typeof inviteApi.acceptInvite>>) => void;
      vi.mocked(inviteApi.acceptInvite).mockReturnValue(
        new Promise((resolve) => {
          resolveAccept = resolve;
        }),
      );
      act(() => {
        screen.getByText('accept-invite').click(); // u1의 수락 — 응답 대기 중
      });
      await waitFor(() => expect(window.localStorage.getItem(pendingKey('u1'))).not.toBeNull());

      // u1 로그아웃 → u2로 재로그인.
      vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'ok', data: undefined, status: 204 });
      await act(async () => {
        screen.getByText('logout').click();
      });
      vi.mocked(authApi.getSession).mockResolvedValue({
        ok: true,
        data: { authenticated: true, userId: 'u2' },
      });
      vi.mocked(profileApi.getProfile).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '서연' },
      });
      vi.mocked(authApi.logIn).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
      await act(async () => {
        screen.getByText('login').click(); // 다른 계정(u2)
      });
      expect(screen.getByTestId('realUser').textContent).toBe('서연');
      expect(window.localStorage.getItem(pendingKey('u2'))).toBeNull(); // u1의 기록이 넘어오지 않았다

      // 이제야 u1의 수락 응답이 도착한다(연결 확정 성공, 재조회는 지금 세션 기준이라 무관하다).
      await act(async () => {
        resolveAccept({ kind: 'ok', status: 200, data: { coupleId: 'couple1' } });
        await Promise.resolve();
        await Promise.resolve();
      });

      // u2 세션은 전혀 영향받지 않는다 — 반응형 값도, u2 자신의 기록도 그대로다.
      expect(screen.getByTestId('realUser').textContent).toBe('서연');
      expect(window.localStorage.getItem(pendingKey('u2'))).toBeNull();
      // u1의 수락은 실제로 확정 성공했다는 사실 자체는 u1 자신의 기록에 남는다(세션이 이미
      // 바뀐 뒤라 이 실행에서 u1의 프로필까지 재확인하지는 못했으므로 완전히 지우지는
      // 않는다) — u1이 나중에 다시 로그인하면 "다시 확인"으로 정상 정리된다. 이번 요청이
      // u2의 어떤 상태도 건드리지 않았다는 것이 이 테스트의 핵심이다.
      expect(JSON.parse(window.localStorage.getItem(pendingKey('u1'))!).phase).toBe(
        'connected-refresh-failed',
      );
    });

    it.each([500, 502, 504] as const)(
      '수락 응답이 %i면 확정 실패로 단정하지 않는다 — 재조회도 실패하면 기록을 unconfirmed로 유지한다',
      async (status) => {
        await signInAsRealUser();
        vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
          kind: 'rejected',
          status,
          error: 'internal-error',
        });
        // 재조회(refreshRealProfile 내부의 getProfile)도 실패한다 — 그래도 "이전 수락이
        // 실패했다"고 확정하지 않는다(연결이 확인되지 않았을 뿐, 반대로 확인된 것도 아니다).
        vi.mocked(profileApi.getProfile).mockResolvedValueOnce({ kind: 'network-error' });
        await act(async () => {
          screen.getByText('accept-invite').click();
        });
        expect(screen.getByTestId('acceptResult').textContent).toBe('unconfirmed');
        expect(JSON.parse(window.localStorage.getItem(pendingKey('u1'))!).phase).toBe(
          'unconfirmed',
        );
        // 수락 POST 자체는 한 번만 보냈다 — 미확정 결과라고 해서 자동으로 반복 전송하지 않는다.
        expect(inviteApi.acceptInvite).toHaveBeenCalledTimes(1);
      },
    );

    it('수락 응답이 5xx이고 재조회에서도 아직 연결이 확인되지 않으면(coupleId 없음) 기록을 unconfirmed로 유지한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'rejected',
        status: 500,
        error: 'internal-error',
      });
      // 조회 자체는 성공했지만 coupleId가 아직 없다 — "서버 연결이 완료됐는지"를 이 한 번의
      // 조회만으로 확정 실패로 볼 수 없다.
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '민준', couple_id: null },
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('unconfirmed');
      expect(JSON.parse(window.localStorage.getItem(pendingKey('u1'))!).phase).toBe('unconfirmed');
    });

    it('수락 응답이 5xx여도 재조회에서 연결이 확인되면 정상 완료로 처리하고 기록을 정리한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
        kind: 'rejected',
        status: 500,
        error: 'internal-error',
      });
      // 500 응답과 달리 서버 상태는 실제로 커밋돼 있었다 — 재조회로 이를 확인한다.
      vi.mocked(profileApi.getProfile).mockResolvedValueOnce({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '민준', couple_id: 'couple1' },
      });
      await act(async () => {
        screen.getByText('accept-invite').click();
      });
      expect(screen.getByTestId('acceptResult').textContent).toBe('ok');
      expect(screen.getByTestId('acceptCoupleId').textContent).toBe('couple1');
      expect(window.localStorage.getItem(pendingKey('u1'))).toBeNull();
    });

    it('계정 전환 후 도착한 이전 요청의 5xx 응답은 원래 계정 자신의 기록만 갱신하고, 새 계정의 상태나 네트워크 요청에는 영향을 주지 않는다', async () => {
      // u1로 로그인해 수락을 시작한다(응답 지연).
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
      renderSession();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));

      let resolveAccept!: (v: Awaited<ReturnType<typeof inviteApi.acceptInvite>>) => void;
      vi.mocked(inviteApi.acceptInvite).mockReturnValue(
        new Promise((resolve) => {
          resolveAccept = resolve;
        }),
      );
      act(() => {
        screen.getByText('accept-invite').click(); // u1의 수락 — 응답 대기 중
      });
      await waitFor(() => expect(window.localStorage.getItem(pendingKey('u1'))).not.toBeNull());

      // u1 로그아웃 → u2로 재로그인.
      vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'ok', data: undefined, status: 204 });
      await act(async () => {
        screen.getByText('logout').click();
      });
      vi.mocked(authApi.getSession).mockResolvedValue({
        ok: true,
        data: { authenticated: true, userId: 'u2' },
      });
      vi.mocked(profileApi.getProfile).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { ...OK_PROFILE, nickname: '서연' },
      });
      vi.mocked(authApi.logIn).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
      await act(async () => {
        screen.getByText('login').click(); // 다른 계정(u2)
      });
      expect(screen.getByTestId('realUser').textContent).toBe('서연');
      expect(window.localStorage.getItem(pendingKey('u2'))).toBeNull();

      const getProfileCallsBeforeLateResponse = vi.mocked(profileApi.getProfile).mock.calls.length;

      // 이제야 u1의 수락 응답이 도착한다(5xx) — 이미 다른 계정(u2) 세션이므로, 이 응답을
      // 처리하며 재조회 같은 후속 네트워크 호출을 새로 보내지 않는다(현재 세션의 쿠키로
      // u1을 확인하려 드는 것을 막는다).
      await act(async () => {
        resolveAccept({ kind: 'rejected', status: 500, error: 'internal-error' });
        await Promise.resolve();
        await Promise.resolve();
      });

      // u2 세션은 전혀 영향받지 않는다 — 반응형 값도, u2 자신의 기록도, 네트워크 호출도.
      expect(screen.getByTestId('realUser').textContent).toBe('서연');
      expect(window.localStorage.getItem(pendingKey('u2'))).toBeNull();
      expect(vi.mocked(profileApi.getProfile).mock.calls.length).toBe(
        getProfileCallsBeforeLateResponse,
      );
      // u1 자신의 기록은 "미확정"으로 남는다 — 500을 확정 실패로 단정해 지워버리지 않는다.
      expect(JSON.parse(window.localStorage.getItem(pendingKey('u1'))!).phase).toBe('unconfirmed');
    });
  });

  describe('realRevokeInvite', () => {
    it('204만 완료로 처리한다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.revokeInvite).mockResolvedValue({ kind: 'ok', status: 204, data: undefined });
      await act(async () => {
        screen.getByText('revoke-invite').click();
      });
      expect(screen.getByTestId('revokeResult').textContent).toBe('ok');
    });

    it('예상 밖 200은 완료로 처리하지 않는다', async () => {
      await signInAsRealUser();
      vi.mocked(inviteApi.revokeInvite).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: undefined,
      });
      await act(async () => {
        screen.getByText('revoke-invite').click();
      });
      expect(screen.getByTestId('revokeResult').textContent).toBe('rejected');
    });
  });

  describe('realGetCouple', () => {
    it('성공 시 ok를 전달한다', async () => {
      await signInAsRealUser();
      vi.mocked(coupleApi.getCouple).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: {
          id: 'couple1',
          connected_at: '2025-01-01T00:00:00Z',
          relationship_start_date: null,
          is_seed: false,
          partner: { nickname: '서연', avatar_emoji: '🐥' },
        },
      });
      await act(async () => {
        screen.getByText('get-couple').click();
      });
      expect(screen.getByTestId('coupleResult').textContent).toBe('ok');
    });

    it('404 not-connected를 구분한다', async () => {
      await signInAsRealUser();
      vi.mocked(coupleApi.getCouple).mockResolvedValue({
        kind: 'rejected',
        status: 404,
        error: 'not-connected',
      });
      await act(async () => {
        screen.getByText('get-couple').click();
      });
      expect(screen.getByTestId('coupleResult').textContent).toBe('not-connected');
    });
  });

  describe('realSetConsent — 확정 성공에서만 로컬 상태를 반영', () => {
    it('200 확정 성공 시 analysisConsent를 반영한다', async () => {
      await signInAsRealUser();
      vi.mocked(consentApi.setConsent).mockResolvedValue({
        kind: 'ok',
        status: 200,
        data: { id: 'e1', user_id: 'u1', granted: true, version: 1, changed_at: '2025-01-01T00:00:00Z' },
      });
      expect(screen.getByTestId('analysisConsent').textContent).toBe('false');
      await act(async () => {
        screen.getByText('set-consent-true').click();
      });
      expect(screen.getByTestId('consentResult').textContent).toBe('ok');
      expect(screen.getByTestId('analysisConsent').textContent).toBe('true');
    });

    it('결과 미확정(202)이면 로컬 값을 임의로 바꾸지 않는다', async () => {
      await signInAsRealUser();
      vi.mocked(consentApi.setConsent).mockResolvedValue({
        kind: 'unknown',
        status: 202,
        message: '확인 중',
      });
      await act(async () => {
        screen.getByText('set-consent-true').click();
      });
      expect(screen.getByTestId('consentResult').textContent).toBe('unknown');
      // false로 확정하지도, true로 낙관적으로 바꾸지도 않는다 — 마지막 확인값 그대로.
      expect(screen.getByTestId('analysisConsent').textContent).toBe('false');
    });

    it('네트워크 오류에도 로컬 값을 바꾸지 않는다', async () => {
      await signInAsRealUser();
      vi.mocked(consentApi.setConsent).mockResolvedValue({ kind: 'network-error' });
      await act(async () => {
        screen.getByText('set-consent-true').click();
      });
      expect(screen.getByTestId('consentResult').textContent).toBe('network-error');
      expect(screen.getByTestId('analysisConsent').textContent).toBe('false');
    });
  });
});

describe('SessionContext — refreshRealProfile 결과 구분', () => {
  async function signInAsRealUser() {
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
    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));
  }

  it('성공하면 ok와 함께 realUser를 갱신한다', async () => {
    await signInAsRealUser();
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'ok',
      status: 200,
      data: { ...OK_PROFILE, nickname: '서연' },
    });
    await act(async () => {
      screen.getByText('refresh-profile').click();
    });
    expect(screen.getByTestId('refreshResult').textContent).toBe('ok');
    expect(screen.getByTestId('realUser').textContent).toBe('서연');
  });

  it('401은 세션 만료(unauthenticated)로 확정하고 세션을 정리한다', async () => {
    await signInAsRealUser();
    vi.mocked(profileApi.getProfile).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });
    await act(async () => {
      screen.getByText('refresh-profile').click();
    });
    expect(screen.getByTestId('refreshResult').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('네트워크 오류·서버 오류는 각각 구분하고 세션을 건드리지 않는다(재조회 재실패)', async () => {
    await signInAsRealUser();
    vi.mocked(profileApi.getProfile).mockResolvedValueOnce({ kind: 'network-error' });
    await act(async () => {
      screen.getByText('refresh-profile').click();
    });
    expect(screen.getByTestId('refreshResult').textContent).toBe('network-error');
    expect(screen.getByTestId('status').textContent).toBe('real-home'); // 세션은 그대로

    // 다시 시도해도 여전히 실패할 수 있다 — 매번 실제 결과를 그대로 돌려준다(성공으로 안 바뀜).
    vi.mocked(profileApi.getProfile).mockResolvedValueOnce({
      kind: 'unknown',
      status: 503,
      message: '서버 점검 중',
    });
    await act(async () => {
      screen.getByText('refresh-profile').click();
    });
    expect(screen.getByTestId('refreshResult').textContent).toBe('server-error');
    expect(screen.getByTestId('status').textContent).toBe('real-home');
  });

  it('로그아웃 뒤 늦게 도착한 재조회 응답은 무효화된 요청(stale)으로 남고 세션을 건드리지 않는다', async () => {
    await signInAsRealUser();
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'ok', data: undefined, status: 204 });
    let resolveProfile!: (v: Awaited<ReturnType<typeof profileApi.getProfile>>) => void;
    vi.mocked(profileApi.getProfile).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );

    await act(async () => {
      screen.getByText('refresh-profile').click(); // 응답 대기 중
    });
    await act(async () => {
      screen.getByText('logout').click(); // 응답이 오기 전에 로그아웃(세대가 올라감)
    });
    expect(screen.getByTestId('status').textContent).toBe('anonymous');

    await act(async () => {
      resolveProfile({ kind: 'ok', status: 200, data: { ...OK_PROFILE, nickname: '늦은응답' } });
      await Promise.resolve();
    });
    // 늦게 도착한 조회 결과가 로그아웃 이후 상태를 되돌리면 안 된다.
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(screen.getByTestId('refreshResult').textContent).toBe('stale');
  });
});

describe('SessionContext — 보호된 API의 401은 세션 만료로 일관되게 처리한다', () => {
  async function signInAsRealUser() {
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
    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home'));
  }

  it('초대 생성 401 → unauthenticated + 세션 정리', async () => {
    await signInAsRealUser();
    vi.mocked(inviteApi.createInvite).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });
    await act(async () => {
      screen.getByText('create-invite').click();
    });
    expect(screen.getByTestId('inviteResult').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('초대 미리보기 401 → unauthenticated + 세션 정리', async () => {
    await signInAsRealUser();
    vi.mocked(inviteApi.previewInvite).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });
    await act(async () => {
      screen.getByText('preview-invite').click();
    });
    expect(screen.getByTestId('previewResult').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('초대 수락 401 → unauthenticated + 세션 정리', async () => {
    await signInAsRealUser();
    vi.mocked(inviteApi.acceptInvite).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });
    await act(async () => {
      screen.getByText('accept-invite').click();
    });
    expect(screen.getByTestId('acceptResult').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('초대 취소 401 → unauthenticated + 세션 정리', async () => {
    await signInAsRealUser();
    vi.mocked(inviteApi.revokeInvite).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });
    await act(async () => {
      screen.getByText('revoke-invite').click();
    });
    expect(screen.getByTestId('revokeResult').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('커플 조회 401 → unauthenticated + 세션 정리', async () => {
    await signInAsRealUser();
    vi.mocked(coupleApi.getCouple).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });
    await act(async () => {
      screen.getByText('get-couple').click();
    });
    expect(screen.getByTestId('coupleResult').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('동의 저장 401 → unauthenticated + 세션 정리', async () => {
    await signInAsRealUser();
    vi.mocked(consentApi.setConsent).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'unauthenticated',
    });
    await act(async () => {
      screen.getByText('set-consent-true').click();
    });
    expect(screen.getByTestId('consentResult').textContent).toBe('unauthenticated');
    expect(screen.getByTestId('status').textContent).toBe('anonymous');
  });

  it('일반 로그인의 비밀번호 오류(401)는 세션 만료로 다루지 않고 기존처럼 rejected로 남긴다', async () => {
    // 로그인 자체의 401(invalid-credentials)은 "보호된 API 호출 중 세션이 끊김"과는 다른
    // 의미다 — 로그인 시도 전이므로 지울 세션 자체가 없다. 기존 동작을 유지해야 한다.
    vi.mocked(authApi.logIn).mockResolvedValue({
      kind: 'rejected',
      status: 401,
      error: 'invalid-credentials',
    });
    renderSession();
    await waitFor(() => expect(screen.getByTestId('initializing').textContent).toBe('false'));
    await act(async () => {
      screen.getByText('login').click();
    });
    expect(screen.getByTestId('loginResult').textContent).toBe('rejected');
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

  it('이전 세션(u1)에서 보낸 요청의 늦은 401이 로그아웃·재로그인으로 바뀐 새 세션(u2)을 지우지 않는다', async () => {
    vi.mocked(authApi.getSession)
      .mockResolvedValueOnce({ ok: true, data: { authenticated: true, userId: 'u1' } }) // 마운트(u1)
      .mockResolvedValue({ ok: true, data: { authenticated: true, userId: 'u2' } }); // 재로그인(u2)
    vi.mocked(profileApi.getProfile)
      .mockResolvedValueOnce({ kind: 'ok', status: 200, data: { ...OK_PROFILE, nickname: '민준' } })
      .mockResolvedValue({ kind: 'ok', status: 200, data: { ...OK_PROFILE, nickname: '서연' } });
    vi.mocked(authApi.logIn).mockResolvedValue({ kind: 'ok', data: { ok: true }, status: 200 });
    vi.mocked(authApi.logOut).mockResolvedValue({ kind: 'ok', data: undefined, status: 204 });

    let resolveCouple!: (v: Awaited<ReturnType<typeof coupleApi.getCouple>>) => void;
    vi.mocked(coupleApi.getCouple).mockReturnValue(
      new Promise((resolve) => {
        resolveCouple = resolve;
      }),
    );

    renderSession();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('real-home')); // u1
    expect(screen.getByTestId('realUser').textContent).toBe('민준');

    await act(async () => {
      screen.getByText('get-couple').click(); // u1 세션에서 보낸 요청 — 응답 대기 중
    });
    await act(async () => {
      screen.getByText('logout').click(); // 로그아웃(세대가 올라감)
    });
    expect(screen.getByTestId('status').textContent).toBe('anonymous');

    await act(async () => {
      screen.getByText('login').click(); // 다른 계정(u2)으로 재로그인
    });
    expect(screen.getByTestId('status').textContent).toBe('real-home');
    expect(screen.getByTestId('realUser').textContent).toBe('서연');

    await act(async () => {
      resolveCouple({ kind: 'rejected', status: 401, error: 'unauthenticated' }); // u1 요청의 늦은 401
      await Promise.resolve();
      await Promise.resolve();
    });

    // 세대가 이미 바뀐 뒤 도착한 401이므로, 이 401을 세션 만료로 처리하는 코드에 도달하지 않고
    // 그냥 버려진다 — u2 세션이 그대로 유지돼야 한다.
    expect(screen.getByTestId('status').textContent).toBe('real-home');
    expect(screen.getByTestId('realUser').textContent).toBe('서연');
    expect(screen.getByTestId('coupleResult').textContent).toBe('network-error');
  });
});
