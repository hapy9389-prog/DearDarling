import { afterEach, describe, expect, it } from 'vitest';
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

afterEach(() => {
  resetAllMockData();
});

describe('가입 → 프로필 → 연결 진입', () => {
  it('시작 화면에서 가입해 프로필을 정하면 연결 허브로 간다', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });

    await user.click(screen.getByRole('button', { name: '함께 시작하기' }));
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

    // 프로필 화면
    const nickname = await screen.findByLabelText('닉네임');
    await user.type(nickname, '테스트');
    await user.click(screen.getByRole('button', { name: '저장하고 계속하기' }));

    expect(await screen.findByText('연인 연결')).toBeInTheDocument();
  });

  it('비밀번호는 어떤 저장소 값에도 남지 않는다', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/signup' });
    const pw = screen.getByLabelText('비밀번호');
    expect(pw).toHaveAttribute('type', 'password');
    await user.type(screen.getByLabelText('이메일'), 'x@x.com');
    await user.type(pw, 'zebra9pw');
    await user.type(screen.getByLabelText('비밀번호 확인'), 'zebra9pw');
    await user.click(screen.getByRole('button', { name: '가입하고 계속하기' }));
    await screen.findByLabelText('닉네임');

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)!;
      expect(window.localStorage.getItem(key) ?? '').not.toContain('zebra9pw');
    }
  });

  it('가입·로그인 화면에 가상 체험 안내가 보인다', () => {
    renderApp({ route: '/signup' });
    expect(screen.getByText(/화면 검토용 가상 체험/)).toBeInTheDocument();
    expect(screen.getByText(/예: test1234/)).toBeInTheDocument();
  });

  it('비밀번호 찾기는 미등록 이메일에도 같은 안내를 보여준다', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/reset' });
    await user.type(screen.getByLabelText('이메일'), 'ghost@a.com');
    await user.click(screen.getByRole('button', { name: '재설정 링크 받기' }));
    expect(await screen.findByText(/재설정 링크를 보냈어요/)).toBeInTheDocument();
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
    await u.click(screen.getByRole('button', { name: /민준·서연 예시 화면 둘러보기/ }));
    await waitFor(() => expect(screen.getByText(/함께한 지/)).toBeInTheDocument());
  });
});
