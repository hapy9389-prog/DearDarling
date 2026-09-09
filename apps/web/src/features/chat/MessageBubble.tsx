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
}: {
  message: ChatMessage;
  isMine: boolean;
  isHighlighted: boolean;
  onRetry?: () => void;
}) {
  const time = new Date(message.createdAt).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed transition-shadow ${
          isMine
            ? 'rounded-br-md bg-mine-bubble text-mine-bubble-text'
            : 'rounded-bl-md bg-partner-bubble text-partner-bubble-text'
        } ${isHighlighted ? 'ring-2 ring-coaching ring-offset-2 ring-offset-canvas' : ''}`}
      >
        {message.body}
      </div>
      <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-ink-faint">
        <span>{time}</span>
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
