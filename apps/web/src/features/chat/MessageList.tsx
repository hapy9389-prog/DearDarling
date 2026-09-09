import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../mocks/types';
import { MessageBubble } from './MessageBubble';

export function MessageList({
  messages,
  myAccountId,
  highlightedMessageIds,
  onRetry,
  savedMemoryMessageIds,
  onOpenMemoryMenu,
}: {
  messages: ChatMessage[];
  myAccountId: string;
  highlightedMessageIds: string[];
  onRetry: (messageId: string) => void;
  savedMemoryMessageIds: string[];
  onOpenMemoryMenu: (messageId: string, trigger: HTMLElement) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // jsdom(테스트 환경)은 scrollIntoView를 구현하지 않으므로 존재할 때만 호출한다.
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages.length]);

  return (
    <div data-testid="message-list" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isMine={message.senderId === myAccountId}
          isHighlighted={highlightedMessageIds.includes(message.id)}
          onRetry={message.status === 'failed' ? () => onRetry(message.id) : undefined}
          savedAsMemory={savedMemoryMessageIds.includes(message.id)}
          onOpenMemoryMenu={message.status === 'saved' ? onOpenMemoryMenu : undefined}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
