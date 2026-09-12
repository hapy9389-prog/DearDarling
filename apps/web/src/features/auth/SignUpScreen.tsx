import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { messageForAuthResult, useSession } from '../../state/SessionContext';
import { validateEmail, validatePassword } from '../../mocks/domain/auth';
import { AuthField } from './AuthField';

const RESEND_COOLDOWN_MS = 60_000; // 서버 쪽 재전송 제한(분당 1회)과 맞춘 안내용 쿨다운

// 가입 요청까지는 끝났지만 아직 이메일 인증이 안 끝난 계정의 "이메일만" 기록해 둔다 — 비밀번호나
// 인증 코드는 여기 들어가지 않는다. 새로고침·화면 이탈 뒤 돌아와도 다시 가입을 시도하지 않고
// 곧장 인증 코드 입력 단계로 돌아올 수 있게 하기 위해서다(이메일 자체는 비밀값이 아니다).
const PENDING_SIGNUP_EMAIL_KEY = 'deardarling:web:v1:pending-signup-email';

function readPendingSignupEmail(): string {
  try {
    return window.localStorage.getItem(PENDING_SIGNUP_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}
function writePendingSignupEmail(email: string): void {
  try {
    window.localStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, email);
  } catch {
    // 접근이 막힌 환경에서는 무시 — 이 세션 안에서는 화면 상태로 여전히 동작한다.
  }
}
function clearPendingSignupEmail(): void {
  try {
    window.localStorage.removeItem(PENDING_SIGNUP_EMAIL_KEY);
  } catch {
    // 무시
  }
}

/**
 * 실제 계정 회원가입 — 이메일·비밀번호 입력 → 이메일 인증 코드 입력(재전송 가능) → 확인되면
 * 로그인 화면으로 안내한다. 인증 직후 자동 로그인은 하지 않는다 — 늦게 도착한 자동 로그인
 * 응답이 화면 상태만 무시되고 브라우저에는 실제로 로그인 쿠키를 남길 수 있어(요청 자체를
 * 취소한 게 아니므로), "다시 시작" 뒤 새로고침하면 방금 버린 이전 계정 세션이 복원되는 문제가
 * 있었다. 자동 로그인 요청 자체를 만들지 않으면 이 문제가 원천적으로 없다. 비밀번호는 인증이
 * 끝나거나 화면을 벗어나면 즉시 메모리에서 지운다(어디에도 저장하지 않는다).
 */
export function SignUpScreen() {
  const navigate = useNavigate();
  const { realSignUp, realConfirmSignUp, realResendConfirmationCode } = useSession();

  const [step, setStep] = useState<'form' | 'code'>(() =>
    readPendingSignupEmail() ? 'code' : 'form',
  );
  const [email, setEmail] = useState(() => readPendingSignupEmail());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    confirm?: string;
    code?: string;
    form?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [canResend, setCanResend] = useState(true);
  const [notice, setNotice] = useState<string>();

  const resendTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 진행 중인 비동기 작업(가입·인증·재전송)을 무효화하기 위한 세대 카운터. "다시 시작"을
  // 누르거나 화면을 벗어나면 증가시킨다 — 이미 보낸 서버 요청 자체를 취소하는 게 아니라,
  // 늦게 도착한 응답이 이제 와서 자동 로그인·화면 이동·상태 변경을 일으키지 못하게 막는다.
  const attemptGenRef = useRef(0);

  const clearSecrets = () => {
    setPassword('');
    setConfirm('');
    setCode('');
  };
  useEffect(
    () => () => {
      attemptGenRef.current += 1;
      clearSecrets();
      clearTimeout(resendTimerRef.current);
    },
    [],
  ); // 화면을 벗어나면(취소 포함) 비밀번호·코드를 비우고 대기 중인 타이머도 정리한다

  function startResendCooldown() {
    setCanResend(false);
    clearTimeout(resendTimerRef.current);
    resendTimerRef.current = setTimeout(() => setCanResend(true), RESEND_COOLDOWN_MS);
  }

  function goToCodeStep() {
    writePendingSignupEmail(email);
    setErrors({});
    setStep('code');
    startResendCooldown();
  }

  async function handleSignUpSubmit(event: FormEvent) {
    event.preventDefault();
    const emailCheck = validateEmail(email);
    const passwordCheck = validatePassword(password);
    const next: typeof errors = {};
    if (!emailCheck.ok) next.email = emailCheck.message;
    if (!passwordCheck.ok) next.password = passwordCheck.message;
    if (password !== confirm) next.confirm = '비밀번호가 일치하지 않아요.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const gen = attemptGenRef.current;
    setSubmitting(true);
    const result = await realSignUp({ email, password });
    if (attemptGenRef.current !== gen) return; // 그사이 "다시 시작"·화면 이탈 — 이 결과는 버린다
    setSubmitting(false);
    if (result.kind === 'needs-confirmation') {
      goToCodeStep();
      return;
    }
    if (result.kind === 'unknown') {
      // 가입 결과를 확정하지 못했다(Cognito 응답 없음) — 실패로 단정하지 않고 인증 단계로
      // 보낸다. 실제로 안 만들어졌다면 코드가 틀렸다는 응답을 받게 되고, 그때 다시 가입하면 된다.
      setNotice(result.message);
      goToCodeStep();
      return;
    }
    setErrors({ form: messageForAuthResult(result) });
  }

  async function handleCodeSubmit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setErrors({ code: '인증 코드를 입력해 주세요.' });
      return;
    }
    setErrors({});
    setSubmitting(true);
    const gen = attemptGenRef.current;
    const confirmResult = await realConfirmSignUp({ email, code: code.trim() });
    if (attemptGenRef.current !== gen) return; // "다시 시작"·화면 이탈 후 도착한 응답 — 무시한다
    if (confirmResult.kind !== 'ok') {
      setSubmitting(false);
      setErrors({ code: messageForAuthResult(confirmResult) });
      return;
    }
    clearPendingSignupEmail(); // 인증이 끝났으니 재개 기록은 더 이상 필요 없다.
    setSubmitting(false);
    clearSecrets(); // 비밀번호·인증 코드를 메모리에 남기지 않는다.
    // 인증 완료 — 자동 로그인을 하지 않고 로그인 화면에서 직접 로그인하게 안내한다(위 설명 참고).
    navigate('/login', {
      replace: true,
      state: { notice: '이메일 인증이 완료됐어요. 로그인해 주세요.' },
    });
  }

  async function handleResend() {
    if (!canResend) return;
    const gen = attemptGenRef.current;
    setSubmitting(true);
    const result = await realResendConfirmationCode({ email });
    if (attemptGenRef.current !== gen) return; // "다시 시작"·화면 이탈 후 도착한 응답 — 무시한다
    setSubmitting(false);
    if (result.kind === 'ok') {
      startResendCooldown();
      setNotice('인증 코드를 다시 보냈어요.');
      return;
    }
    setNotice(undefined);
    setErrors({ code: messageForAuthResult(result) });
  }

  function handleStartOver() {
    attemptGenRef.current += 1; // 진행 중이던 가입·인증·재전송 응답을 이제부터 전부 무시한다
    clearPendingSignupEmail();
    clearSecrets();
    setEmail('');
    setErrors({});
    setNotice(undefined);
    setSubmitting(false);
    setStep('form');
  }

  if (step === 'code') {
    return (
      <div className="flex flex-1 flex-col">
        <p className="font-display text-2xl text-ink">이메일 인증</p>
        <p className="mt-1 text-sm text-ink-soft">{email}로 받은 인증 코드를 입력해 주세요.</p>

        <form onSubmit={handleCodeSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <AuthField
            label="인증 코드"
            type="text"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={errors.code}
          />
          {notice && <p className="text-xs text-ink-faint">{notice}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-full bg-accent px-4 py-3 text-sm font-medium text-canvas-raised disabled:opacity-60"
          >
            {submitting ? '확인 중…' : '확인'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleResend}
          disabled={submitting || !canResend}
          className="mt-4 text-center text-xs text-ink-faint underline disabled:opacity-50"
        >
          인증 코드 다시 보내기
        </button>
        <button
          type="button"
          onClick={handleStartOver}
          className="mt-2 text-center text-xs text-ink-faint underline"
        >
          다른 이메일로 다시 시작
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="font-display text-2xl text-ink">회원가입</p>
      <p className="mt-1 text-sm text-ink-soft">이메일과 비밀번호로 계정을 만들어요.</p>

      <form onSubmit={handleSignUpSubmit} className="mt-6 flex flex-col gap-4" noValidate>
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
          hint="영문+숫자 8자 이상 (예: test1234)"
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
