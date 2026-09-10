import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { normalizeCode } from '../../mocks/domain/invite';
import { createMockInviteService, type LookupResult } from '../../mocks/services/inviteService';
import { Avatar } from '../../shared/components/Avatar';

const inviteService = createMockInviteService();

const LOOKUP_ERROR: Record<Exclude<LookupResult['status'], 'ok'>, string> = {
  'not-found': '유효하지 않은 코드예요.',
  expired: '만료된 코드예요. 상대에게 새 코드를 받아 주세요.',
  revoked: '취소된 코드예요.',
  'already-accepted': '이미 사용된 코드예요.',
  self: '본인 코드예요.',
  'accepter-already-connected': '이미 다른 사람과 연결돼 있어요.',
  'inviter-already-connected': '상대가 이미 다른 사람과 연결돼 있어요.',
};

/** 받은 초대 코드 입력 → 상대 확인 → 연결(0010). */
export function JoinByCodeScreen() {
  const navigate = useNavigate();
  const { session, status, currentGen, refreshTrialUser } = useSession();
  const userId = session?.kind === 'trial' ? session.userId : '';

  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState<{
    code: string;
    nickname: string;
    avatar: string;
  } | null>(null);
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (status === 'trial-connected') {
    return <Navigate to="/app/home" replace />;
  }

  function handleLookup(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const result = inviteService.lookupInvite(code, userId);
    if (result.status === 'ok') {
      setConfirming({
        code: result.code,
        nickname: result.inviterNickname,
        avatar: result.inviterAvatar,
      });
      return;
    }
    setError(LOOKUP_ERROR[result.status]);
  }

  async function handleConnect() {
    if (!confirming) return;
    setBusy(true);
    const gen = currentGen();
    const result = await inviteService.acceptInvite(confirming.code, userId, {
      relationshipStartDate: startDate || null,
    });
    // 세션이 바뀌었으면(로그아웃·계정 전환 등) 이 결과로 화면을 옮기지 않는다.
    if (currentGen() !== gen) return;
    setBusy(false);
    if (result.ok) {
      refreshTrialUser();
      navigate('/app/home', { replace: true });
      return;
    }
    setConfirming(null);
    setError(LOOKUP_ERROR[result.reason]);
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">받은 코드 입력</p>

      {confirming ? (
        <div className="mt-6">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-canvas-raised px-4 py-4">
            <Avatar emoji={confirming.avatar} size={40} />
            <div>
              <p className="text-sm font-medium text-ink">{confirming.nickname}</p>
              <p className="text-xs text-ink-faint">이 분과 연결할까요?</p>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium text-ink">사귀기 시작한 날</span>
            <span className="mb-2 block text-xs text-ink-faint">
              선택 · 나중에 설정에서 정할 수 있어요
            </span>
            <input
              aria-label="사귀기 시작한 날"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm text-ink-soft"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConnect}
              disabled={busy}
              className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-canvas-raised disabled:opacity-60"
            >
              {busy ? '연결 중…' : '연결'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleLookup} className="mt-6 flex flex-col gap-4" noValidate>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">초대 코드</span>
            <input
              aria-label="초대 코드"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onBlur={() => code && setCode(normalizeCode(code))}
              placeholder="DD-XXXXXX"
              autoCapitalize="characters"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm tracking-widest uppercase outline-none focus:border-accent"
            />
            {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
          </label>
          <button
            type="submit"
            className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
          >
            확인
          </button>
          <button
            type="button"
            onClick={() => navigate('/connect')}
            className="text-center text-xs text-ink-faint underline"
          >
            대신 초대 코드 보내기
          </button>
        </form>
      )}
    </div>
  );
}
