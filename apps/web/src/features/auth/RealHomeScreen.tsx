import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { SESSION_EXPIRED_MESSAGE, useSession, type CoupleFetchResult } from '../../state/SessionContext';
import { Avatar } from '../../shared/components/Avatar';

function messageFor(result: { kind: string; message?: string }): string {
  if (result.kind === 'rate-limited') return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (result.kind === 'network-error') {
    return '연결에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }
  return result.message ?? '불러오지 못했어요.';
}

/**
 * 실제 계정의 홈. 프로필까지만 연결됐던 이전 단계와 달리, 이제 초대·커플 연결·동의까지
 * 실제 API에 연결됐다 — `realUser.coupleId` 유무로 "아직 연결 전" / "연결됨"을 나눠 보여준다.
 * 대화·AI 코칭 등 `/app/*` 본편은 여전히 다음 단계다.
 */
export function RealHomeScreen() {
  const navigate = useNavigate();
  const { realUser, realGetCouple, logOut } = useSession();

  const connected = Boolean(realUser?.coupleId);

  const [couple, setCouple] = useState<{
    partnerNickname: string;
    partnerAvatarEmoji: string;
    connectedAt: string;
    relationshipStartDate: string | null;
  }>();
  const [loading, setLoading] = useState(connected);
  const [error, setError] = useState<string>();

  const genRef = useRef(0);
  useEffect(() => () => {
    genRef.current += 1;
  }, []);

  useEffect(() => {
    if (!connected) return;
    const gen = genRef.current;
    void (async () => {
      // 첫 setState 전에 마이크로태스크를 하나 거친다 — effect 본문에서 직접 동기 호출된
      // 것으로 잡히지 않게 한다(SessionContext.checkRealSession과 동일한 패턴).
      await Promise.resolve();
      if (genRef.current !== gen) return;
      setLoading(true);
      setError(undefined);
      const result: CoupleFetchResult = await realGetCouple();
      if (genRef.current !== gen) return;
      setLoading(false);
      if (result.kind === 'ok') {
        setCouple(result.couple);
        return;
      }
      if (result.kind === 'not-connected') {
        // 방금 재조회한 프로필이 아직 coupleId 반영 전이었을 수 있다 — 실패로 안내하지
        // 않고 조용히 "연결 전" 화면처럼 둔다(다음 재조회에서 자연히 맞춰진다).
        return;
      }
      if (result.kind === 'unauthenticated') {
        navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
        return;
      }
      setError(messageFor(result));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      {realUser && <Avatar emoji={realUser.avatarEmoji || '💌'} size={56} />}
      <div>
        <p className="font-display text-xl text-ink">
          {realUser?.nickname ? `${realUser.nickname}님, 환영해요` : '환영해요'}
        </p>
        {connected ? (
          loading ? (
            <p className="mt-2 text-sm text-ink-soft">연결 정보를 불러오는 중…</p>
          ) : error ? (
            <p className="mt-2 text-sm text-danger">{error}</p>
          ) : couple ? (
            <p className="mt-2 text-sm text-ink-soft">
              {couple.partnerNickname || '상대'}님과 연결됐어요.
              <br />
              {couple.relationshipStartDate
                ? `${couple.relationshipStartDate}부터 함께하고 있어요.`
                : '대화·AI 코칭 등은 아직 준비 중이에요.'}
            </p>
          ) : null
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            아직 연인과 연결되지 않았어요.
            <br />
            대화·AI 코칭은 연결 이후에도 준비 중이에요.
          </p>
        )}
      </div>
      <div className="mt-4 flex w-full flex-col gap-2">
        {!connected && (
          <button
            type="button"
            onClick={() => navigate('/real/connect')}
            className="w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
          >
            연인과 연결하기
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/real/consent')}
          className="w-full rounded-full border border-border px-4 py-3 text-sm font-medium text-ink"
        >
          AI 분석 동의
        </button>
        <button
          type="button"
          onClick={() => navigate('/real/profile')}
          className="w-full rounded-full border border-border px-4 py-3 text-sm font-medium text-ink"
        >
          프로필 수정
        </button>
        <button
          type="button"
          onClick={() => {
            void logOut();
          }}
          className="w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
