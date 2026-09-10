import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** 입력창이 이 높이까지 자라면 이후에는 내부 스크롤로 넘긴다(대화 영역·하단 탭을 계속 쓸 수 있도록). */
const MAX_HEIGHT_PX = 120;

export function MessageInputBar({
  draft,
  onDraftChange,
  onSend,
  disabled,
  onCompositionChange,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (value: string) => void;
  disabled: boolean;
  /** 한글 조합 중인지 부모에 알린다 — 조합 중에는 표현 도움 힌트를 갱신·표시하지 않는다. */
  onCompositionChange?: (composing: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // 대화 화면이 숨겨진 동안(display:none)에는 scrollHeight가 0이다. 이때 높이를 만지면 입력창이
    // 한 줄보다 낮게 찌부러진다 — 아무것도 하지 않고 rows=1·min-height 기본값을 유지한다.
    // (대화 탭이 보이면 아래 IntersectionObserver가 다시 계산한다.)
    if (el.scrollHeight === 0) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [draft, resize]);

  // 숨겨졌던 대화 화면이 다시 보이는 순간(hidden 해제) 입력창을 다시 잰다.
  // ResizeObserver 대신 IntersectionObserver를 쓴다 — 높이 조정이 스스로를 재트리거하는 루프가 없다.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) resize();
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  function handleSendClick() {
    if (!draft.trim() || disabled) return;
    onSend(draft);
  }

  return (
    // <form>이 아니라 일반 컨테이너를 쓴다 — <form>이었다면 Enter나 한글 조합 확정 Enter가
    // 자동 제출(전송)로 이어질 수 있다. textarea라서 일반 Enter는 줄바꿈이 되고, 어떤 키 핸들러도
    // 없어 조합 확정 Enter든 일반 Enter든 전송으로 이어질 코드 경로가 없다. 전송은 오직 버튼 클릭.
    <div className="flex items-end gap-2 border-t border-border bg-canvas-raised px-3 py-2.5">
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onCompositionStart={() => onCompositionChange?.(true)}
        onCompositionEnd={() => onCompositionChange?.(false)}
        placeholder="메시지를 입력하세요"
        aria-label="메시지 입력"
        className="no-scrollbar max-h-[120px] min-h-[2.5rem] flex-1 resize-none overflow-y-auto rounded-2xl border border-border bg-canvas px-4 py-2.5 text-sm outline-none placeholder:text-ink-faint"
      />
      <button
        type="button"
        onClick={handleSendClick}
        disabled={!draft.trim() || disabled}
        className="shrink-0 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-canvas-raised disabled:opacity-40"
      >
        전송
      </button>
    </div>
  );
}
