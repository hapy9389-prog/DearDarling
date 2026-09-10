import { useState } from 'react';
import type { Invite } from '../../mocks/types';
import { createMockInviteService } from '../../mocks/services/inviteService';

const inviteService = createMockInviteService();

/**
 * 초대 코드 만들기·복사·대기 취소(0010). 상대가 코드를 입력하면 연결되는데, 가상 처리라
 * 실시간 알림이 없으므로 "연결 상태 확인"을 눌러 갱신한다(부모가 `onCheckConnected`로 처리).
 */
export function InviteCodeCard({
  userId,
  onCheckConnected,
}: {
  userId: string;
  onCheckConnected: () => void;
}) {
  const [invite, setInvite] = useState<Invite | null>(() => inviteService.getActiveInvite(userId));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  async function handleCreate() {
    setBusy(true);
    setError(undefined);
    const result = await inviteService.createInvite(userId);
    setBusy(false);
    if (result.ok) setInvite(result.invite);
    else setError(result.message);
  }

  async function handleCopy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('복사할 수 없어요. 코드를 직접 입력해 주세요.');
    }
  }

  function handleRevoke() {
    if (!invite) return;
    inviteService.revokeInvite(invite.code);
    setInvite(null);
  }

  return (
    <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
      <p className="eyebrow mb-2 text-ink-faint">초대 코드 보내기</p>

      {invite ? (
        <>
          <p className="rounded-lg bg-canvas px-3 py-3 text-center font-display text-xl tracking-widest text-ink">
            {invite.code}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            상대가 이 코드를 입력하면 연결돼요. 코드를 전해 주세요.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 rounded-full border border-border px-3 py-2 text-sm font-medium text-ink"
            >
              {copied ? '복사됨' : '복사'}
            </button>
            <button
              type="button"
              onClick={handleRevoke}
              className="flex-1 rounded-full border border-border px-3 py-2 text-sm text-ink-soft"
            >
              대기 취소
            </button>
          </div>
          <button
            type="button"
            onClick={onCheckConnected}
            className="mt-2 w-full rounded-full px-3 py-2 text-xs text-accent underline"
          >
            연결 상태 확인
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-canvas-raised disabled:opacity-60"
        >
          {busy ? '만드는 중…' : '초대 코드 만들기'}
        </button>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
