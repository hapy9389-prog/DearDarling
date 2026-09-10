/**
 * "AI 분석 동의" 토글 하나(0010). 순수 컴포넌트 — 상태는 상위에서 관리한다.
 * `/consent`(연결 전, 내 설정만)와 `/app/settings`(연결 후, 상대 상태도 함께)에서 재사용한다.
 */
export function ConsentToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-border p-3 ${disabled ? 'opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-accent"
      />
      <span className="flex-1">
        <span className="text-sm font-medium">AI 분석 동의</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
          두 사람이 모두 동의한 기간에 나눈 대화를 AI가 살펴보고 코칭·주간 리포트·패턴 관찰에
          사용해요. 기본은 꺼져 있고, 동의하지 않아도 연결·대화는 그대로 이용할 수 있어요.
        </span>
      </span>
    </label>
  );
}
