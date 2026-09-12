import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  INVITE_REASON_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  useSession,
  type InviteReason,
} from '../../state/SessionContext';
import { normalizeCode } from '../../mocks/domain/invite'; // 순수 함수(상태 없음) — mocks/services는 쓰지 않는다
import { Avatar } from '../../shared/components/Avatar';

function messageForInviteResult(result: { kind: string; reason?: InviteReason; message?: string }): string {
  if (result.kind === 'invite-rejected' && result.reason) return INVITE_REASON_MESSAGE[result.reason];
  if (result.kind === 'rate-limited') return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (result.kind === 'network-error') {
    return '연결에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
  }
  return result.message ?? '요청을 처리하지 못했어요.';
}

/**
 * 수락 이후 화면이 있을 수 있는 상태를 명시적으로 구분한다 — `notice` 문구의 유무만으로
 * 버튼·요청 가능 여부를 결정하지 않는다.
 *  - `idle`: 아직 수락을 시도하지 않음(또는 확정 거절 뒤 코드를 다시 고칠 수 있는 상태).
 *  - `accepting`: 수락 요청을 서버에 보낸 뒤 응답을 기다리는 중 — 이미 보낸 요청은 화면에서
 *    취소할 수 없다.
 *  - `connected-refresh-failed`: 서버가 연결 자체는 확정 성공시켰지만, 그 직후 내 정보
 *    재조회만 실패했다 — "수락 실패"가 아니다. 조회만 다시 시도할 수 있다.
 *  - `unconfirmed`: 수락 요청 결과 자체가 미확정이다(202/503 또는 응답 유실 가능성이 있는
 *    네트워크 오류) — 성공도 확정 실패도 아니다. 다른 초대를 새로 시작하게 두면 서버에 이미
 *    가 있을 수 있는 원래 요청과 뒤섞일 수 있으므로, 조회로 확인하는 것 말고는 아무 것도
 *    허용하지 않는다.
 *  - `connected`: 조회로 연결이 확인됐다 — 곧바로 홈으로 이동하고 이 화면을 벗어난다.
 */
type AcceptPhase = 'idle' | 'accepting' | 'connected-refresh-failed' | 'unconfirmed' | 'connected';

/**
 * 실제 계정 — 받은 초대 코드 입력 → 미리보기(상대 확인) → 수락. `GET /api/invites/:code`로
 * 조회만 하고 커밋하지 않으므로, 미리보기 이후에도 취소·만료·다른 사람 수락이 있을 수 있다 —
 * 최종 수락은 서버가 자기 트랜잭션에서 다시 검증한다(이 화면은 그 결과를 사유별로 보여줄
 * 뿐이다. 기존 잠금·동시 수락 방어는 서버 쪽에 그대로 있다).
 *
 * 수락 요청을 보낸 뒤에는 화면에서 "취소"해도 서버 처리 자체가 취소되지 않는다 — 그래서 수락이
 * 진행 중인 동안에는 취소·코드 변경 대신 결과를 기다렸다가, 결과에 맞는 다음 행동만 제공한다.
 * 결과가 확정되지 않은 동안(`connected-refresh-failed`/`unconfirmed`)에는 "처음부터 다시"를
 * 허용하지 않는다 — 원래 수락의 서버 쪽 결과가 아직 불확실한 채로 다른 초대를 새로 시작하면
 * 뒤섞일 수 있기 때문이다.
 *
 * **화면 밖(계정별) 복원**: 위 두 미확정 상태는 `SessionContext.pendingInviteAccept`에
 * localStorage로 남는다(수락 요청을 보내기 전에 먼저 기록됨) — 이 화면의 `useState`만으로는
 * 화면을 나갔다 들어오거나 새로고침하면 사라지므로, 마운트 시 그 기록을 읽어 `phase`를
 * 되살리고, 곧바로 서버 상태부터 재확인한다(코드 입력·미리보기·새 수락은 그동안 막는다).
 */
export function RealJoinByCodeScreen() {
  const navigate = useNavigate();
  const { realPreviewInvite, realAcceptInvite, refreshRealProfile, pendingInviteAccept, clearPendingInviteAccept } =
    useSession();

  // 'accepting'으로 복원됐다면 원래 요청을 다시 기다릴 방법이 없다(새로고침으로 그 자리에서
  // 대기하던 fetch 자체가 사라졌다) — 서버 처리는 취소됐다고 가정하지 않고, 곧바로
  // 'unconfirmed'와 같은 방식(조회로 확인)으로 다룬다.
  const restoredPhase: AcceptPhase | null = pendingInviteAccept
    ? pendingInviteAccept.phase === 'accepting'
      ? 'unconfirmed'
      : pendingInviteAccept.phase
    : null;

  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState<{
    code: string; // 미리보기로 확인한 "바로 그" 코드 — 수락 때 이 값을 그대로 쓴다(입력창의
    // 현재 값이 그사이 바뀌었어도 섞이지 않는다).
    nickname: string;
    avatarEmoji: string;
  } | null>(null);
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string | undefined>(() =>
    restoredPhase ? '이전 초대 수락 결과를 확인하고 있어요.' : undefined,
  );
  const [phase, setPhase] = useState<AcceptPhase>(() => restoredPhase ?? 'idle');
  const [busy, setBusy] = useState(false);

  // 화면 단위 요청 유효성 검사 — 코드를 바꿔 다시 조회하거나 화면을 벗어나면 이전 미리보기
  // 응답이 늦게 도착해도 무시한다(자동 로그인 회귀 수정과 같은 패턴). 수락은 서버에 이미 보낸
  // 뒤라 이 세대값으로 "취소"하지 않는다 — 오직 이 화면이 그 결과를 반영할지만 결정한다.
  const attemptGenRef = useRef(0);
  useEffect(
    () => () => {
      attemptGenRef.current += 1;
    },
    [],
  );

  /** 코드 입력이 바뀔 때마다 호출한다 — 진행 중이던 미리보기 요청을 무효화하고, 그 요청이
   * 남긴 로딩 상태·오류를 새 입력이 즉시 덮어쓴다(늦게 도착해도 더 이상 영향을 주지 않는다). */
  function handleCodeChange(value: string) {
    setCode(value);
    attemptGenRef.current += 1;
    setBusy(false);
    setError(undefined);
  }

  async function handleLookup(event: FormEvent) {
    event.preventDefault();
    if (busy || phase !== 'idle') return; // 수락 진행/미확정 중에는 새 조회를 시작하지 않는다
    attemptGenRef.current += 1; // 새 조회 시작 — 이전에 진행 중이던 미리보기는 이제 무시한다
    const gen = attemptGenRef.current;
    const normalized = normalizeCode(code);
    setError(undefined);
    setBusy(true);
    const result = await realPreviewInvite(normalized);
    if (attemptGenRef.current !== gen) return; // 그사이 코드가 바뀌었거나 화면을 벗어남
    setBusy(false);
    if (result.kind === 'ok') {
      setConfirming({ code: normalized, nickname: result.nickname, avatarEmoji: result.avatarEmoji });
      return;
    }
    if (result.kind === 'unauthenticated') {
      navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
      return;
    }
    setError(messageForInviteResult(result));
  }

  /** "취소" — 수락을 시도하기 전(`idle`)에만 쓸 수 있다. 확정 거절 뒤 코드를 고쳐 다시
   * 시도하는 것과 같은 성격이라 여기서는 자유롭게 허용한다. */
  function handleBackToEdit() {
    if (busy || phase !== 'idle') return; // 진행/미확정 중에는 이 버튼 자체를 노출하지 않지만 방어적으로 막는다
    attemptGenRef.current += 1;
    setBusy(false);
    setConfirming(null);
    setError(undefined);
    setNotice(undefined);
  }

  async function handleConnect() {
    if (!confirming || busy || phase !== 'idle') return; // 이미 진행 중이거나 미확정이면 중복 제출하지 않는다
    const gen = attemptGenRef.current;
    setBusy(true);
    setPhase('accepting'); // SessionContext.realAcceptInvite가 요청 직전에 계정별 기록도 남긴다
    setError(undefined);
    setNotice(undefined);
    // 미리보기에서 확인한 코드를 그대로 쓴다(입력창 값이 아니다) — 그 사이 취소·만료·다른
    // 사람의 수락이 있었을 수 있으므로, 서버가 이 요청을 자기 트랜잭션에서 다시 검증한다.
    const result = await realAcceptInvite({
      code: confirming.code,
      relationshipStartDate: startDate || null,
    });
    if (attemptGenRef.current !== gen) return; // 화면을 이미 벗어남 — busy는 그때 정리됐다
    setBusy(false);
    if (result.kind === 'ok') {
      setPhase('connected');
      navigate('/real/home', { replace: true });
      return;
    }
    if (result.kind === 'connected-refresh-failed') {
      // 연결 자체는 서버에서 확정 성공했다 — "수락 실패"로 보이면 안 된다. phase가
      // idle로 돌아가지 않으므로 "연결" 버튼이 다시 나타나지 않는다(수락 POST 재전송 차단).
      // 계정별 기록은 SessionContext가 이미 남겨 뒀다(화면 재진입 시 여기로 복원된다).
      setPhase('connected-refresh-failed');
      setNotice('연결은 완료됐지만 정보를 불러오지 못했습니다. 다시 확인해 주세요.');
      return;
    }
    if (result.kind === 'unconfirmed') {
      // 수락 결과 자체가 미확정이다 — 성공도 확정 실패도 아니므로 그렇게 안내하지 않는다.
      // phase가 그대로 남아 "처음부터 다시"·새 조회를 막는다(조회만 가능).
      setPhase('unconfirmed');
      setNotice('연결 결과를 확인하지 못했습니다. 다시 확인해 주세요.');
      return;
    }
    if (result.kind === 'unauthenticated') {
      // 기록은 SessionContext에 남아 있다(같은 계정으로 다시 로그인하면 이어서 확인한다).
      navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
      return;
    }
    // 서버가 확정적으로 거절했다(만료·자기 코드·이미 연결됨 등) — 코드 수정·새 시도를
    // 허용한다(idle로 되돌아간다). 계정별 기록도 SessionContext가 이미 정리했다.
    setPhase('idle');
    setConfirming(null);
    setError(messageForInviteResult(result));
  }

  /** "다시 확인" — `connected-refresh-failed`/`unconfirmed`에서만 쓸 수 있다(재진입 시 자동
   * 으로도 한 번 실행된다). 수락 POST를 새로 보내지 않고, 내 프로필 상태(coupleId)만 다시
   * 조회한다. 조회가 실제로 성공하고 coupleId까지 확인된 경우에만 완료 화면으로 이동한다 —
   * 한 번의 조회에서 coupleId가 없다는 것만으로, 또는 시간이 얼마나 지났는지만으로 이전
   * 수락이 실패했다고 확정하지 않는다(phase·기록을 그대로 둔다). */
  async function handleRecheckConnection() {
    if (busy || (phase !== 'connected-refresh-failed' && phase !== 'unconfirmed')) return;
    const gen = attemptGenRef.current;
    setBusy(true);
    const result = await refreshRealProfile();
    if (attemptGenRef.current !== gen) return; // 그사이 화면을 벗어남 — busy는 handleBackToEdit이 정리
    setBusy(false);
    if (result.kind === 'ok' && result.profile.coupleId) {
      clearPendingInviteAccept(); // 연결이 확인됐다 — 계정별 기록을 정리한다.
      setPhase('connected');
      navigate('/real/home', { replace: true });
      return;
    }
    if (result.kind === 'unauthenticated') {
      // 기록은 그대로 둔다 — 같은 계정으로 다시 로그인하면 이어서 확인할 수 있다.
      navigate('/login', { replace: true, state: { notice: SESSION_EXPIRED_MESSAGE } });
      return;
    }
    if (result.kind === 'stale') return; // 세션이 이미 바뀜 — 이 화면과 무관해졌다
    // 조회가 됐지만 아직 coupleId가 없거나(아직 확인 안 됨), 조회 자체가 실패했다 — 둘 다
    // "이전 수락이 실패했다"는 뜻이 아니다. phase·기록은 그대로 두고 다시 시도만 안내한다.
    setNotice(
      result.kind === 'ok'
        ? '아직 연결이 확인되지 않았습니다. 잠시 후 다시 확인해 주세요.'
        : '연결 상태를 확인하지 못했습니다. 다시 확인해 주세요.',
    );
  }

  // 재진입 시(마운트) 기존 미확정 기록이 있으면 코드 입력·미리보기·새 수락 대신 서버 상태부터
  // 확인한다 — "화면을 나갔다 들어오면 잊어버린다"는 문제를 없앤다. 브라우저에 남은 이 기록은
  // 어디까지나 화면 복구용일 뿐이고, 실제 연결 여부·권한은 서버(realAcceptInvite가 부르는
  // 재조회)가 그대로 판단한다.
  useEffect(() => {
    if (restoredPhase === 'connected-refresh-failed' || restoredPhase === 'unconfirmed') {
      void (async () => {
        // 첫 setState 전에 마이크로태스크를 하나 거친다 — effect 본문에서 직접 동기 호출된
        // 것으로 잡히지 않게 한다(SessionContext.checkRealSession과 동일한 패턴).
        await Promise.resolve();
        await handleRecheckConnection();
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inAmbiguousPhase = phase === 'connected-refresh-failed' || phase === 'unconfirmed';
  const accepting = phase === 'accepting';

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">받은 코드 입력</p>

      {inAmbiguousPhase ? (
        // 연결 여부가 아직 불확실한 상태(새로 수락을 시도했거나, 재진입으로 복원됐거나) —
        // "연결"·"취소"·"처음부터 다시"를 전부 없애고 조회(다시 확인)만 허용한다. 원래
        // 요청의 서버 쪽 결과가 불확실한 채로 다른 초대를 새로 시작하면 뒤섞일 수 있다.
        <div className="mt-6 flex flex-col gap-3">
          {(confirming?.code ?? pendingInviteAccept?.code) && (
            <p className="rounded-lg bg-canvas-raised px-3 py-3 text-center font-display text-lg tracking-widest text-ink">
              {confirming?.code ?? pendingInviteAccept?.code}
            </p>
          )}
          <p className="text-xs text-ink-soft">{notice}</p>
          <button
            type="button"
            onClick={() => void handleRecheckConnection()}
            disabled={busy}
            className="w-full rounded-full bg-accent px-3 py-2 text-xs font-medium text-canvas-raised disabled:opacity-60"
          >
            {busy ? '확인 중…' : '다시 확인'}
          </button>
        </div>
      ) : confirming ? (
        <div className="mt-6">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-canvas-raised px-4 py-4">
            <Avatar emoji={confirming.avatarEmoji || '🙂'} size={40} />
            <div>
              <p className="text-sm font-medium text-ink">{confirming.nickname || '상대'}</p>
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
              disabled={phase !== 'idle'}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
          </label>

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={handleBackToEdit}
              disabled={accepting}
              className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm text-ink-soft disabled:opacity-60"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={accepting}
              className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-canvas-raised disabled:opacity-60"
            >
              {accepting ? '연결 중…' : '연결'}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void handleLookup(e)} className="mt-6 flex flex-col gap-4" noValidate>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">초대 코드</span>
            <input
              aria-label="초대 코드"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              onBlur={() => code && handleCodeChange(normalizeCode(code))}
              placeholder="DD-XXXXXX"
              autoCapitalize="characters"
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm tracking-widest uppercase outline-none focus:border-accent"
            />
            {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised disabled:opacity-60"
          >
            {busy ? '확인 중…' : '확인'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/real/connect')}
            className="text-center text-xs text-ink-faint underline"
          >
            대신 초대 코드 보내기
          </button>
        </form>
      )}
    </div>
  );
}
