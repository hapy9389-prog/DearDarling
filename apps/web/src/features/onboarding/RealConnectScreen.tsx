import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { SESSION_EXPIRED_MESSAGE, useSession } from '../../state/SessionContext';
import { Avatar } from '../../shared/components/Avatar';

/**
 * 실제 계정 — 초대 코드 만들기/복사/취소(가입한 파트너를 초대). `POST /api/invites`는
 * 멱등이라(이미 활성 초대가 있으면 그걸 그대로 돌려줌) 마운트 시 호출해도 새 코드가 생기지
 * 않는다 — "내 초대 코드 가져오기"로 그대로 쓴다. mock `InviteCodeCard`/`inviteService`는
 * 전혀 쓰지 않는다(실제 계정 전용, `RequireRealAccount` 아래에서만 렌더링됨).
 */
export function RealConnectScreen() {
  const navigate = useNavigate();
  const { realUser, realCreateInvite, realRevokeInvite, logOut } = useSession();

  const [code, setCode] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  const genRef = useRef(0);
  useEffect(() => () => {
    genRef.current += 1;
  }, []);

  useEffect(() => {
    const gen = genRef.current;
    void (async () => {
      const result = await realCreateInvite();
      if (genRef.current !== gen) return;
      setLoading(false);
      if (result.kind === 'ok') {
        setCode(result.code);
        return;
      }
      if (result.kind === 'unauthenticated') {
        navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
        return;
      }
      setError(messageFor(result));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    setBusy(true);
    setError(undefined);
    const gen = genRef.current;
    const result = await realCreateInvite();
    if (genRef.current !== gen) return;
    setBusy(false);
    if (result.kind === 'ok') {
      setCode(result.code);
      return;
    }
    if (result.kind === 'unauthenticated') {
      navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
      return;
    }
    setError(messageFor(result));
  }

  async function handleCopy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('복사할 수 없어요. 코드를 직접 입력해 주세요.');
    }
  }

  async function handleRevoke() {
    if (!code) return;
    setBusy(true);
    setError(undefined);
    const gen = genRef.current;
    const result = await realRevokeInvite(code);
    if (genRef.current !== gen) return;
    setBusy(false);
    if (result.kind === 'ok') {
      setCode(undefined);
      return;
    }
    if (result.kind === 'unauthenticated') {
      navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
      return;
    }
    setError(messageFor(result));
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">연인 연결</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        두 사람이 연결되면 커플 정보를 함께 쓸 수 있어요. 나중에 연결해도 괜찮아요.
      </p>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-canvas-raised px-4 py-3">
        <Avatar emoji={realUser?.avatarEmoji || '🙂'} size={36} />
        <div className="flex-1">
          <p className="text-sm font-medium text-ink">{realUser?.nickname || '나'}</p>
          <p className="text-xs text-ink-faint">아직 연결 전이에요</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/real/profile')}
          className="text-xs text-accent underline"
        >
          프로필 수정
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
          <p className="eyebrow mb-2 text-ink-faint">초대 코드 보내기</p>
          {loading ? (
            <p className="text-xs text-ink-faint">불러오는 중…</p>
          ) : code ? (
            <>
              <p className="rounded-lg bg-canvas px-3 py-3 text-center font-display text-xl tracking-widest text-ink">
                {code}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                상대가 이 코드를 입력하면 연결돼요. 코드를 전해 주세요.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={busy}
                  className="flex-1 rounded-full border border-border px-3 py-2 text-sm font-medium text-ink disabled:opacity-60"
                >
                  {copied ? '복사됨' : '복사'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevoke()}
                  disabled={busy}
                  className="flex-1 rounded-full border border-border px-3 py-2 text-sm text-ink-soft disabled:opacity-60"
                >
                  대기 취소
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-canvas-raised disabled:opacity-60"
            >
              {busy ? '만드는 중…' : '초대 코드 만들기'}
            </button>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </section>

        <button
          type="button"
          onClick={() => navigate('/real/connect/join')}
          className="w-full rounded-2xl border border-border bg-canvas-raised px-4 py-3 text-left text-sm font-medium text-ink"
        >
          받은 코드 입력하기
        </button>

        <button
          type="button"
          onClick={() => navigate('/real/consent')}
          className="w-full rounded-2xl border border-border bg-canvas-raised px-4 py-3 text-left"
        >
          <span className="text-sm font-medium text-ink">AI 분석 동의</span>
          <span className="mt-0.5 block text-xs text-ink-soft">
            선택 사항 · 지금 정하지 않아도 돼요
          </span>
        </button>
      </div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <p className="text-xs text-ink-faint">
          연결은 나중에 해도 돼요 — 이 화면으로 다시 올 수 있어요.
        </p>
        <button type="button" onClick={() => void logOut()} className="text-xs text-ink-faint underline">
          로그아웃
        </button>
      </div>
    </div>
  );
}

function messageFor(result: { kind: string; message?: string }): string {
  if (result.kind === 'rate-limited') return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (result.kind === 'network-error') {
    return '연결에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }
  return result.message ?? '요청을 처리하지 못했어요.';
}
