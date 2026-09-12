import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { messageForAuthResult, useSession } from '../../state/SessionContext';
import { validateEmail, validatePassword } from '../../mocks/domain/auth';
import { AuthField } from './AuthField';

export function LogInScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { realLogIn, retryRealSessionConfirmation } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  // 로그인 POST 자체는 성공했지만(쿠키가 실제로 붙었는지·프로필 확인) 그 다음 확인만 실패한
  // 경우 — 로그인 POST를 다시 보내지 않고 확인만 재시도할 수 있게 별도로 다룬다.
  const [confirmMessage, setConfirmMessage] = useState<string>();
  const notice = (location.state as { notice?: string } | null)?.notice;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const emailCheck = validateEmail(email);
    const passwordCheck = validatePassword(password);
    const next: typeof errors = {};
    if (!emailCheck.ok) next.email = emailCheck.message;
    if (!passwordCheck.ok) next.password = passwordCheck.message;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setConfirmMessage(undefined);
    setSubmitting(true);
    const result = await realLogIn({ email, password });
    setSubmitting(false);
    setPassword(''); // 성공·실패 상관없이 메모리에 남겨 두지 않는다
    if (result.kind === 'ok') {
      // 다음 단계(프로필/홈)는 `/`의 RedirectIfAuthed 가드가 세션 상태에 맞춰 정한다.
      navigate('/', { replace: true });
      return;
    }
    if (result.kind === 'confirmation-failed') {
      // 로그인 자체는 됐을 수 있다 — 다시 로그인하지 않고 확인만 재시도할 수 있게 안내한다.
      setConfirmMessage(result.message);
      return;
    }
    setErrors({ form: messageForAuthResult(result) });
  }

  async function handleRetryConfirmation() {
    setSubmitting(true);
    const result = await retryRealSessionConfirmation();
    setSubmitting(false);
    if (result.kind === 'ok') {
      navigate('/', { replace: true });
      return;
    }
    if (result.kind === 'confirmation-failed') {
      setConfirmMessage(result.message);
      return;
    }
    // cookie-not-applied 등 — 재시도로는 회복되지 않는 상황이니 처음부터 다시 로그인하게 한다.
    setConfirmMessage(undefined);
    setErrors({ form: messageForAuthResult(result) });
  }

  if (confirmMessage) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-2 text-center">
        <p className="text-sm text-ink-soft">{confirmMessage}</p>
        <button
          type="button"
          onClick={() => void handleRetryConfirmation()}
          disabled={submitting}
          className="w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised disabled:opacity-60"
        >
          {submitting ? '확인 중…' : '다시 확인'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmMessage(undefined)}
          className="text-xs text-ink-faint underline"
        >
          로그인 화면으로
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">로그인</p>
      <p className="mt-1 text-sm text-ink-soft">가입할 때 쓴 이메일·비밀번호로 들어가요.</p>
      {notice && (
        <p className="mt-3 rounded-lg border border-border bg-canvas-raised px-3 py-2 text-xs text-ink-soft">
          {notice}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <AuthField
          label="이메일"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <AuthField
          label="비밀번호"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="영문+숫자 8자 이상"
          error={errors.password}
        />
        {errors.form && <p className="text-xs text-danger">{errors.form}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised disabled:opacity-60"
        >
          {submitting ? '확인 중…' : '로그인'}
        </button>
      </form>

      <div className="mt-4 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/reset')}
          className="text-xs text-ink-faint underline"
        >
          비밀번호를 잊으셨나요?
        </button>
        <button
          type="button"
          onClick={() => navigate('/signup')}
          className="text-xs text-ink-faint underline"
        >
          아직 계정이 없어요
        </button>
      </div>
    </div>
  );
}
