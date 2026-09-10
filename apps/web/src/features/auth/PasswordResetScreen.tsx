import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { validateEmail } from '../../mocks/domain/auth';
import { AuthField } from './AuthField';

export function PasswordResetScreen() {
  const navigate = useNavigate();
  const { requestPasswordReset } = useSession();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const check = validateEmail(email);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(undefined);
    setSubmitting(true);
    const result = await requestPasswordReset({ email });
    setSubmitting(false);
    // 계정 존재 여부와 무관하게 같은 안내를 보여준다.
    setNotice(result.message || '재설정 링크를 보냈어요 (예시).');
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">비밀번호 찾기</p>
      <p className="mt-1 text-sm text-ink-soft">
        가입에 쓴 이메일을 입력하면 재설정 안내를 보여드려요.
      </p>

      {notice ? (
        <div className="mt-6 rounded-xl border border-border bg-canvas-raised px-4 py-4">
          <p className="text-sm leading-relaxed text-ink-soft">{notice}</p>
          <p className="mt-1 text-xs text-ink-faint">실제 메일은 보내지 않아요.</p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="mt-4 w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-ink"
          >
            로그인으로 돌아가기
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
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
            {submitting ? '처리 중…' : '재설정 링크 받기'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-center text-xs text-ink-faint underline"
          >
            로그인으로 돌아가기
          </button>
        </form>
      )}
    </div>
  );
}
