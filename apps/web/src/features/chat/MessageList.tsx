import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '../../mocks/types';
import { MessageBubble } from './MessageBubble';
import { isNearBottom, shouldFollowToBottom } from './scrollBehavior';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const didInitialScrollRef = useRef(false);
  const prevCountRef = useRef(messages.length);
  const prevLastIdRef = useRef<string | undefined>(messages[messages.length - 1]?.id);

  function scrollToBottom() {
    const el = containerRef.current;
    if (!el) return;
    // jsdom 등 scrollTo가 없는 환경에서도 안전하게.
    el.scrollTo?.({ top: el.scrollHeight });
    nearBottomRef.current = true;
  }

  function handleScroll() {
    const el = containerRef.current;
    if (el) nearBottomRef.current = isNearBottom(el);
  }

  // 첫 진입: 대화 화면이 실제로 보이고 레이아웃이 잡힌 뒤 최신 메시지로 한 번만 이동한다.
  // 탭을 다시 방문하면(이미 한 번 했으면) 아무 것도 하지 않아 스크롤 위치가 그대로 유지된다.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      if (!didInitialScrollRef.current) {
        scrollToBottom();
        didInitialScrollRef.current = true;
      }
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!didInitialScrollRef.current && entries.some((entry) => entry.isIntersecting)) {
        scrollToBottom();
        didInitialScrollRef.current = true;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 목록이 바뀌면: 내가 보냈으면 최신으로, 수신은 직전에 하단을 보고 있던 경우에만 따라간다.
  useLayoutEffect(() => {
    const last = messages[messages.length - 1];
    const follow = shouldFollowToBottom({
      grew: messages.length > prevCountRef.current,
      lastMessageId: last?.id,
      prevLastMessageId: prevLastIdRef.current,
      lastFromMe: last?.senderId === myAccountId,
      wasNearBottom: nearBottomRef.current,
    });
    prevCountRef.current = messages.length;
    prevLastIdRef.current = last?.id;

    // 첫 진입 스크롤은 위 옵저버가 담당한다(레이아웃 전에 여기서 하면 어긋난다).
    if (!didInitialScrollRef.current) return;
    if (follow) scrollToBottom();
  }, [messages, myAccountId]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-testid="message-list"
      className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4"
    >
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
    </div>
  );
}
