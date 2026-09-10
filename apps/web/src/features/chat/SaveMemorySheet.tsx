import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage, Memory } from '../../mocks/types';
import { getAccount } from '../../mocks/fixtures/accounts';
import { Avatar } from '../../shared/components/Avatar';
import { conversationDateLabel } from '../../mocks/domain/memories';

/**
 * 대화 화면 진입점: 저장 완료된 말풍선을 누르면 열리는 하단 시트(docs/decisions/0008).
 * 말풍선 탭 → 액션 메뉴 → '추억으로 저장' → 미리보기 2단계. 저장하기 전 취소하면 아무 것도 저장되지 않는다.
 * 이미 저장된 메시지면 '추억에서 보기'만 안내한다.
 */
export function SaveMemorySheet({
  message,
  existingMemory,
  note,
  onNoteChange,
  onSave,
  onViewMemory,
  onClose,
  returnFocusTo,
}: {
  message: ChatMessage;
  existingMemory?: Memory;
  note: string;
  onNoteChange: (value: string) => void;
  onSave: () => void;
  onViewMemory: (memoryId: string) => void;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const [step, setStep] = useState<'menu' | 'preview'>('menu');
  const panelRef = useRef<HTMLDivElement>(null);

  // 시트가 열리거나 단계가 바뀌면 패널의 첫 버튼으로 포커스를 옮긴다.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [step]);

  // 닫히면 원래 눌렀던 말풍선으로 포커스를 되돌린다.
  useEffect(() => {
    return () => returnFocusTo?.focus();
  }, [returnFocusTo]);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('button, textarea') ?? [],
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const sender = getAccount(message.senderId);

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end" onKeyDown={handleKeyDown}>
      <button
        type="button"
        aria-label="추억 저장 닫기"
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="추억 저장"
        className="relative max-h-[85%] overflow-y-auto rounded-t-2xl bg-canvas-raised p-5 shadow-2xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />

        {existingMemory ? (
          <section>
            <p className="font-display text-lg">이미 추억에 저장했어요</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              이 메시지는 두 사람의 추억으로 이미 간직하고 있어요.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => onViewMemory(existingMemory.id)}
                className="flex-1 rounded-full bg-accent py-2 text-sm font-medium text-canvas-raised"
              >
                추억에서 보기
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full border border-border py-2 text-sm text-ink-soft"
              >
                닫기
              </button>
            </div>
          </section>
        ) : step === 'menu' ? (
          <section>
            <p className="font-display text-lg">이 메시지를…</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setStep('preview')}
                className="rounded-xl border border-border px-4 py-3 text-left text-sm font-medium text-ink"
              >
                추억으로 저장
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-3 text-left text-sm text-ink-soft"
              >
                취소
              </button>
            </div>
          </section>
        ) : (
          <section>
            <p className="font-display text-lg">추억으로 저장</p>

            <div className="mt-3 rounded-2xl border border-border bg-canvas px-4 py-3">
              <p className="border-l-2 border-border pl-2 text-sm leading-relaxed whitespace-pre-wrap text-ink italic">
                {message.body}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
                <Avatar emoji={sender.avatarEmoji} size={20} />
                <span>{sender.nickname}</span>
                <span aria-hidden="true">·</span>
                <span>{conversationDateLabel(message.createdAt)}</span>
              </div>
            </div>

            <label className="mt-3 block">
              <span className="eyebrow text-ink-faint">메모 (선택)</span>
              <textarea
                aria-label="추억 메모"
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                rows={3}
                placeholder="이 순간에 대해 남기고 싶은 말"
                className="mt-1 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none"
              />
            </label>

            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              사진·영상 첨부는 곧 지원해요.
            </p>
            <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-soft">
              저장하면 상대에게도 보여요.
            </p>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onSave}
                className="flex-1 rounded-full bg-accent py-2 text-sm font-medium text-canvas-raised"
              >
                저장
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full border border-border py-2 text-sm text-ink-soft"
              >
                취소
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
