import { useId, type InputHTMLAttributes } from 'react';

/**
 * 가입·로그인·재설정 화면의 라벨 + 입력 + 오류 행(0010).
 * 비밀번호 필드는 `type="password"`로만 쓰고, 값은 상위 컴포넌트의 로컬 state로만 다룬다 —
 * 저장소·로그에 남기지 않는다.
 */
export function AuthField({
  label,
  hint,
  error,
  ...inputProps
}: {
  label: string;
  hint?: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
        {...inputProps}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
