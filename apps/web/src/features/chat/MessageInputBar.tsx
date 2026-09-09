export function MessageInputBar({
  draft,
  onDraftChange,
  onSend,
  disabled,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (value: string) => void;
  disabled: boolean;
}) {
  function handleSendClick() {
    if (!draft.trim() || disabled) return;
    onSend(draft);
  }

  return (
    // <form>이 아니라 일반 컨테이너를 쓴다 — <form>이었다면 입력창에서 Enter를 누르거나
    // 한글 조합을 Enter로 확정할 때 브라우저가 자동으로 제출(전송)해 버릴 수 있다.
    // 전송은 오직 아래 버튼 클릭으로만 일어나야 한다.
    <div className="flex items-end gap-2 border-t border-border bg-canvas-raised px-3 py-2.5">
      <input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="메시지를 입력하세요"
        aria-label="메시지 입력"
        className="flex-1 rounded-full border border-border bg-canvas px-4 py-2.5 text-sm outline-none placeholder:text-ink-faint"
      />
      <button
        type="button"
        onClick={handleSendClick}
        disabled={!draft.trim() || disabled}
        className="rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-canvas-raised disabled:opacity-40"
      >
        전송
      </button>
    </div>
  );
}
