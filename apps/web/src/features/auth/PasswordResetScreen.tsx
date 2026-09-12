import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { messageForAuthResult, useSession } from '../../state/SessionContext';
import { normalizeEmail, validateEmail, validatePassword } from '../../mocks/domain/auth';
import { AuthField } from './AuthField';

/**
 * 실제 계정 비밀번호 재설정 — 이메일 요청 → 코드+새 비밀번호 입력 → 확인. 확인이 끝나면
 * 보안을 위해 자동 로그인하지 않고 로그인 화면으로 안내한다(비밀번호가 바뀌었으므로). 새
 * 비밀번호는 화면을 벗어나면 메모리에서 지운다.
 */
export function PasswordResetScreen() {
  const navigate = useNavigate();
  const { session, realUser, realRequestPasswordReset, realConfirmPasswordReset, retryRealSessionConfirmation } =
    useSession();

  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(
    () => () => {
      setCode('');
      setNewPassword('');
    },
    [],
  );

  async function handleRequestSubmit(event: FormEvent) {
    event.preventDefault();
    const check = validateEmail(email);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const result = await realRequestPasswordReset({ email });
    setSubmitting(false);
    if (result.kind === 'ok') {
      setStep('confirm');
      return;
    }
    setError(messageForAuthResult(result));
  }

  async function handleConfirmSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setError('인증 코드를 입력해 주세요.');
      return;
    }
    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.ok) {
      setError(passwordCheck.message);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const result = await realConfirmPasswordReset({ email, code: code.trim(), newPassword });
    setSubmitting(false);
    if (result.kind === 'ok' || result.kind === 'unknown') {
      // unknown이어도 서버 메시지가 "비밀번호는 바뀌었을 수 있다"는 안내라 로그인 화면으로
      // 보낸다 — 화면에는 성공을 단정하는 문구 대신 서버가 준 안내를 그대로 보여준다.
      setCode('');
      setNewPassword('');
      if (session?.kind === 'real' && realUser?.email && normalizeEmail(realUser.email) === normalizeEmail(email)) {
        // 로그인한 채로 "본인" 계정 비밀번호를 재설정한 경우 — 서버 세션이 무효화됐을 수
        // 있다. 무조건 로그아웃 처리하지 않고 서버에 실제로 다시 물어봐서(re-verify) 그
        // 결과대로만 로컬 상태를 정리한다. 다른 계정을 재설정한 경우(realUser와 email이
        // 다름)나 애초에 로그인 상태가 아니었던 경우는 건드리지 않는다.
        await retryRealSessionConfirmation();
      }
      navigate('/login', {
        replace: true,
        state: { notice: messageForAuthResult(result) || '비밀번호가 변경됐어요. 다시 로그인해 주세요.' },
      });
      return;
    }
    setError(messageForAuthResult(result));
  }

  if (step === 'confirm') {
    return (
      <div className="flex flex-1 flex-col">
        <p className="font-display text-2xl text-ink">비밀번호 재설정</p>
        <p className="mt-1 text-sm text-ink-soft">{email}로 받은 코드와 새 비밀번호를 입력해요.</p>

        <form onSubmit={handleConfirmSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <AuthField
            label="인증 코드"
            type="text"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <AuthField
            label="새 비밀번호"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint="영문+숫자 8자 이상"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised disabled:opacity-60"
          >
            {submitting ? '확인 중…' : '비밀번호 변경'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-center text-xs text-ink-faint underline"
          >
            로그인으로 돌아가기
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">비밀번호 찾기</p>
      <p className="mt-1 text-sm text-ink-soft">가입에 쓴 이메일을 입력하면 재설정 코드를 보내요.</p>

      <form onSubmit={handleRequestSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <AuthField
          label="이메일"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
        />
        <button
          type="submit"
          disabled={submitting}
          className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised disabled:opacity-60"
        >
          {submitting ? '처리 중…' : '재설정 코드 받기'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-center text-xs text-ink-faint underline"
        >
          로그인으로 돌아가기
        </button>
      </form>
    </div>
  );
}
