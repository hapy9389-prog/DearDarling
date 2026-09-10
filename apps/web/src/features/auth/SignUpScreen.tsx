import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../../state/SessionContext';
import { validateEmail, validatePassword } from '../../mocks/domain/auth';
import { AuthField } from './AuthField';

export function SignUpScreen() {
  const navigate = useNavigate();
  const { signUp } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    confirm?: string;
    form?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const emailCheck = validateEmail(email);
    const passwordCheck = validatePassword(password);
    const next: typeof errors = {};
    if (!emailCheck.ok) next.email = emailCheck.message;
    if (!passwordCheck.ok) next.password = passwordCheck.message;
    if (password !== confirm) next.confirm = '비밀번호가 일치하지 않아요.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    const result = await signUp({ email, password });
    setSubmitting(false);
    if (result.ok) {
      // 프로필 미완료 상태이므로 `/`의 가드가 프로필 화면으로 보낸다.
      navigate('/', { replace: true });
      return;
    }
    if (result.code === 'email-taken') setErrors({ email: result.message });
    else if (result.code === 'invalid-email') setErrors({ email: result.message });
    else if (result.code === 'invalid-password') setErrors({ password: result.message });
    else setErrors({ form: result.message });
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">회원가입</p>
      <p className="mt-1 text-sm text-ink-soft">이메일과 비밀번호로 체험 계정을 만들어요.</p>

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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="테스트용 비밀번호를 입력하세요 · 영문+숫자 8자 이상 (예: test1234)"
          error={errors.password}
        />
        <AuthField
          label="비밀번호 확인"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        {errors.form && <p className="text-xs text-danger">{errors.form}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised disabled:opacity-60"
        >
          {submitting ? '가입 중…' : '가입하고 계속하기'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => navigate('/login')}
        className="mt-4 text-center text-xs text-ink-faint underline"
      >
        이미 계정이 있어요
      </button>
    </div>
  );
}
