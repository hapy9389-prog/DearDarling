import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { validateEmail, validatePassword } from '../../mocks/domain/auth';
import { AuthField } from './AuthField';

export function LogInScreen() {
  const navigate = useNavigate();
  const { logIn } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const emailCheck = validateEmail(email);
    const passwordCheck = validatePassword(password);
    const next: typeof errors = {};
    if (!emailCheck.ok) next.email = emailCheck.message;
    if (!passwordCheck.ok) next.password = passwordCheck.message;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    const result = await logIn({ email, password });
    setSubmitting(false);
    if (result.ok) {
      // 다음 단계(프로필/연결/홈)는 `/`의 RedirectIfAuthed 가드가 세션 상태에 맞춰 정한다.
      navigate('/', { replace: true });
      return;
    }
    if (result.code === 'no-account') setErrors({ email: result.message });
    else if (result.code === 'invalid-email') setErrors({ email: result.message });
    else if (result.code === 'invalid-password') setErrors({ password: result.message });
    else setErrors({ form: result.message });
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">로그인</p>
      <p className="mt-1 text-sm text-ink-soft">
        가입할 때 쓴 테스트용 이메일·비밀번호로 들어가요.
      </p>

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
          hint="테스트용 비밀번호 (영문+숫자 8자 이상)"
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
