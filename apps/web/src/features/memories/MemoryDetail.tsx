import { useState } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useMemories } from '../../state/MemoriesContext';
import { getAccount } from '../../mocks/fixtures/accounts';
import { canEditMemory, conversationDateLabel, memoryImages } from '../../mocks/domain/memories';
import type { Memory } from '../../mocks/types';
import { ExampleImage } from './ExampleImage';

/**
 * 추억 상세 — 사진 갤러리 + 대화 인용 전문 + 메모를 한 화면에서 함께 본다(docs/decisions/0008).
 * 메모 수정·삭제는 저장한 사람만. 삭제해도 원래 대화 메시지는 지우지 않는다.
 */
export function MemoryDetail({ memory, onBack }: { memory: Memory; onBack: () => void }) {
  const { account } = useActiveAccount();
  const { updateNote, deleteMemory } = useMemories();

  const canEdit = canEditMemory(memory, account.id);
  const sender = getAccount(memory.quoteSenderId);
  const savedBy = getAccount(memory.savedByUserId);
  const images = memoryImages(memory);

  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(memory.note ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 계정을 전환하면 편집·삭제 확인 중이던 상태를 버린다(ChatPage가 초안을 비우는 것과 같은 규칙).
  const [editorAccountId, setEditorAccountId] = useState(account.id);
  if (editorAccountId !== account.id) {
    setEditorAccountId(account.id);
    setEditing(false);
    setNoteDraft(memory.note ?? '');
    setConfirmingDelete(false);
  }

  function saveNote() {
    updateNote(memory.id, noteDraft);
    setEditing(false);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-4">
      <button type="button" onClick={onBack} className="self-start text-sm text-accent">
        ← 추억 목록
      </button>

      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          {images.map((image) => (
            <ExampleImage key={`${image.variant}-${image.alt}`} image={image} size="full" />
          ))}
        </div>
      )}

      <blockquote className="border-l-2 border-border pl-3 text-base leading-relaxed text-ink italic">
        {memory.quoteBody}
      </blockquote>

      <div className="text-xs text-ink-faint">
        <p>
          {sender.nickname}의 말 · 대화 {conversationDateLabel(memory.conversationAt)}
        </p>
        <p className="mt-0.5">
          {savedBy.nickname}님이 간직했어요
          {memory.fromSuggestion && ' · AI가 발견한 순간'}
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-3">
        <p className="eyebrow mb-1 text-ink-faint">메모</p>
        {editing ? (
          <div>
            <textarea
              aria-label="추억 메모 수정"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={saveNote}
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-canvas-raised"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setNoteDraft(memory.note ?? '');
                }}
                className="rounded-full border border-border px-4 py-1.5 text-sm text-ink-soft"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-ink-soft">
              {memory.note ?? '남긴 메모가 없어요.'}
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setNoteDraft(memory.note ?? '');
                  setEditing(true);
                }}
                className="mt-2 text-xs font-medium text-accent"
              >
                메모 수정
              </button>
            )}
          </>
        )}
      </section>

      {canEdit && !editing && (
        <div>
          {confirmingDelete ? (
            <div className="rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3">
              <p className="text-sm leading-relaxed text-ink">
                두 사람의 추억 목록에서 사라집니다. 원래 대화 메시지는 지워지지 않아요.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    deleteMemory(memory.id);
                    onBack();
                  }}
                  className="rounded-full bg-danger px-4 py-1.5 text-sm font-medium text-canvas-raised"
                >
                  삭제
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-full border border-border px-4 py-1.5 text-sm text-ink-soft"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-xs font-medium text-danger"
            >
              추억 삭제
            </button>
          )}
        </div>
      )}
    </div>
  );
}
