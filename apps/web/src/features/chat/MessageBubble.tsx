import { useRef, type MouseEvent } from 'react';
import type { ChatMessage } from '../../mocks/types';

const STATUS_LABEL: Record<ChatMessage['status'], string> = {
  sending: '전송 중',
  saved: '저장 완료',
  failed: '전송 실패',
};

export function MessageBubble({
  message,
  isMine,
  isHighlighted,
  onRetry,
  savedAsMemory = false,
  onOpenMemoryMenu,
}: {
  message: ChatMessage;
  isMine: boolean;
  isHighlighted: boolean;
  onRetry?: () => void;
  savedAsMemory?: boolean;
  /** 저장 완료된 메시지에서만 제공된다 — 말풍선을 눌러 추억 저장 메뉴를 연다. */
  onOpenMemoryMenu?: (messageId: string, trigger: HTMLElement) => void;
}) {
  const time = new Date(message.createdAt).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const bubbleClass = `max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed transition-shadow ${
    isMine
      ? 'rounded-br-md bg-mine-bubble text-mine-bubble-text'
      : 'rounded-bl-md bg-partner-bubble text-partner-bubble-text'
  } ${isHighlighted ? 'ring-2 ring-coaching ring-offset-2 ring-offset-canvas' : ''}`;

  function handleActivate(event: MouseEvent<HTMLButtonElement>) {
    if (!onOpenMemoryMenu) return;
    // 키보드(Enter·Space)로 활성화하면 detail === 0 — 이땐 항상 연다.
    if (event.detail !== 0) {
      const selection = window.getSelection?.()?.toString() ?? '';
      if (selection.trim()) return; // 텍스트를 선택 중이면 메뉴를 열지 않는다.
      const start = pointerStart.current;
      if (
        start &&
        (Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8)
      ) {
        return; // 드래그·스크롤로 간주한다.
      }
    }
    onOpenMemoryMenu(message.id, event.currentTarget);
  }

  return (
    <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
      {onOpenMemoryMenu ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-label={`추억 메뉴 열기: ${message.body}`}
          onPointerDown={(event) => {
            pointerStart.current = { x: event.clientX, y: event.clientY };
          }}
          onClick={handleActivate}
          className={`${bubbleClass} cursor-pointer text-left select-text active:brightness-95`}
        >
          {message.body}
        </button>
      ) : (
        <div className={bubbleClass}>{message.body}</div>
      )}

      <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-ink-faint">
        <span>{time}</span>
        {savedAsMemory && (
          <>
            <span aria-hidden="true">·</span>
            <span className="text-ink-faint">추억에 저장됨</span>
          </>
        )}
        {isMine && (
          <>
            <span aria-hidden="true">·</span>
            <span className={message.status === 'failed' ? 'text-danger' : undefined}>
              {STATUS_LABEL[message.status]}
            </span>
            {message.status === 'failed' && onRetry && (
              <button type="button" onClick={onRetry} className="font-medium text-accent underline">
                다시 보내기
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
