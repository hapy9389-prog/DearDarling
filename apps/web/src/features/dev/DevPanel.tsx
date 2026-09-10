import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useSession, type ReviewAccountId } from '../../state/SessionContext';
import { createMockAuthService } from '../../mocks/services/authService';
import { createMockInviteService } from '../../mocks/services/inviteService';
import { DEFAULT_TRIAL_AVATAR } from '../../mocks/fixtures/trial';
import { resetAllMockData } from '../../mocks/storage';
import { Avatar } from '../../shared/components/Avatar';
import { DevPanelSlotContext, useDevPanelSlot } from './devPanelSlot';

const authService = createMockAuthService();
const inviteService = createMockInviteService();

/**
 * DevPanel의 열림 상태와 슬롯 DOM을 들고 있는 Provider. `<Routes>`와 `<DevPanel>`을 함께 감싸
 * `AppDevTools`(라우트 안쪽)도 같은 상태를 볼 수 있게 한다.
 */
export function DevPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const setSlotRef = useCallback((node: HTMLElement | null) => setElement(node), []);

  return (
    <DevPanelSlotContext.Provider value={{ open, setOpen, element, setSlotRef }}>
      {children}
      <DevPanel />
    </DevPanelSlotContext.Provider>
  );
}

/**
 * 화면 검토용 도구(0010). 전역에 있고 `useSession()`만 쓴다 — `/app` Context에 의존하지 않는다.
 * `/app` 안에서만 의미 있는 레버(시나리오·주간 리포트·추억)는 `AppDevTools`가 이 패널의 슬롯으로
 * 포털 렌더한다.
 */
function DevPanel() {
  const { open, setOpen, setSlotRef } = useDevPanelSlot();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="검토 도구 열기"
        className="absolute top-0.5 right-1.5 z-40 flex items-center gap-1 rounded-full bg-ink/90 px-2 py-1 text-[11px] font-medium text-canvas shadow-sm"
      >
        <span aria-hidden="true">🛠️</span>
        <span className="eyebrow">검토</span>
      </button>

      {open && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label="검토 도구 닫기"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[85%] overflow-y-auto rounded-t-2xl bg-canvas-raised p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />
            <SessionSection onClose={() => setOpen(false)} />
            {/* /app 레버는 여기로 들어온다(AppDevTools가 포털). */}
            <div ref={setSlotRef} />
            <Divider />
            <ResetSection />
          </div>
        </div>
      )}
    </>
  );
}

export function Divider() {
  return <div className="my-4 h-px bg-border" />;
}

function SessionSection({ onClose }: { onClose: () => void }) {
  const { status, session, trialUser, enterReviewMode } = useSession();
  const isTrial = status.startsWith('trial-');
  const trialUsers = authService.listUsers();

  return (
    <section>
      <h2 className="eyebrow mb-2 text-ink-soft">세션</h2>

      {status === 'review' && (
        <>
          <p className="mb-1 text-xs font-medium text-ink-soft">테스트 계정 전환</p>
          <ReviewAccountSwitcher />
        </>
      )}

      {/* 체험 가입이 있으면 어느 모드에서든 그 세션으로 점프할 수 있다(예시↔체험 왕복). */}
      {trialUsers.length > 0 && <TrialSessionSwitcher onClose={onClose} />}

      {isTrial && <TrialConnectionTools onClose={onClose} />}

      {status !== 'review' && (
        <button
          type="button"
          onClick={() => {
            enterReviewMode('user-minjun');
            onClose();
          }}
          className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-left text-sm text-ink-soft"
        >
          리뷰 모드로 보기 (민준·서연 예시)
        </button>
      )}

      <p className="mt-2 text-[11px] text-ink-faint">
        현재: {describeStatus(status)}
        {session?.kind === 'trial' && trialUser ? ` · ${trialUser.nickname || '(닉네임 전)'}` : ''}
      </p>
    </section>
  );
}

function describeStatus(status: string): string {
  return (
    {
      anonymous: '익명(시작 화면)',
      'trial-incomplete': '체험 · 프로필 전',
      'trial-unconnected': '체험 · 연결 전',
      'trial-connected': '체험 · 연결됨',
      review: '리뷰 모드',
    }[status] ?? status
  );
}

function ReviewAccountSwitcher() {
  const { session, switchReviewAccount } = useSession();
  const current = session?.kind === 'review' ? session.accountId : 'user-minjun';
  const accounts: { id: ReviewAccountId; nickname: string; emoji: string }[] = [
    { id: 'user-minjun', nickname: '민준', emoji: '🐻' },
    { id: 'user-seoyeon', nickname: '서연', emoji: '🐱' },
  ];
  return (
    <div className="flex gap-2">
      {accounts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => switchReviewAccount(a.id)}
          className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
            a.id === current
              ? 'border-accent bg-accent-soft text-ink'
              : 'border-border text-ink-soft'
          }`}
        >
          <Avatar emoji={a.emoji} size={28} />
          <span>
            {a.nickname}
            {a.id === current && <span className="ml-1 text-xs text-accent">(현재)</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function TrialSessionSwitcher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { session, switchTrialPerspective } = useSession();
  const users = authService.listUsers();
  const currentId = session?.kind === 'trial' ? session.userId : '';

  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-medium text-ink-soft">체험 계정 / 시점 전환</p>
      <div className="flex flex-wrap gap-2">
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => {
              switchTrialPerspective(u.id);
              onClose();
              // 새 세션 상태(프로필 전 / 미연결 / 연결됨)에 맞는 화면으로 가드가 보낸다.
              navigate('/', { replace: true });
            }}
            className={`rounded-xl border px-3 py-1.5 text-xs ${
              u.id === currentId
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-border text-ink-soft'
            }`}
          >
            {u.nickname || u.email}
          </button>
        ))}
      </div>
    </div>
  );
}

function TrialConnectionTools({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { session, status, refreshTrialUser } = useSession();
  const [busy, setBusy] = useState(false);

  async function connectSyntheticPartner() {
    if (session?.kind !== 'trial') return;
    setBusy(true);
    const created = await inviteService.createInvite(session.userId);
    if (!created.ok) {
      setBusy(false);
      return;
    }
    const partner = authService.createUser({
      email: `partner-${Date.now()}@trial.local`,
      nickname: '상대 (가상)',
      avatarEmoji: DEFAULT_TRIAL_AVATAR,
    });
    await inviteService.acceptInvite(created.invite.code, partner.id);
    setBusy(false);
    refreshTrialUser();
    onClose();
    navigate('/app/home', { replace: true });
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {status === 'trial-unconnected' && (
        <button
          type="button"
          onClick={connectSyntheticPartner}
          disabled={busy}
          className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm text-ink-soft disabled:opacity-60"
        >
          {busy ? '연결 중…' : '가상 상대와 연결 (검토용)'}
        </button>
      )}

      {status === 'trial-connected' && (
        <button
          type="button"
          onClick={() => {
            if (session?.kind !== 'trial') return;
            authService.disconnectCouple(session.userId);
            refreshTrialUser();
            onClose();
            navigate('/connect', { replace: true });
          }}
          className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm text-ink-soft"
        >
          연결 해제 (검토용)
        </button>
      )}
    </div>
  );
}

function ResetSection() {
  return (
    <section>
      <h2 className="eyebrow mb-2 text-ink-soft">데이터 초기화</h2>
      <p className="mb-2 text-xs text-ink-soft">
        가상 데이터를 모두 처음 상태로 되돌려요. 로그아웃되고 체험 가입도 삭제돼요. 실제 서버에는
        아무 영향이 없어요.
      </p>
      <button
        type="button"
        onClick={() => {
          if (window.confirm('가상 데이터를 모두 초기 상태로 되돌릴까요? (로그아웃됩니다)')) {
            resetAllMockData();
            window.location.reload();
          }
        }}
        className="w-full rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
      >
        가상 데이터 초기화
      </button>
    </section>
  );
}
