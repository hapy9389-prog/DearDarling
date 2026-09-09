export function OverwriteDraftDialog({
  suggestion,
  onConfirm,
  onCancel,
}: {
  suggestion: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/30 px-4 pb-24">
      <div className="w-full max-w-[380px] rounded-2xl bg-canvas-raised p-4 shadow-xl">
        <p className="mb-1 text-sm font-medium">이미 작성 중인 내용이 있어요</p>
        <p className="mb-3 text-xs text-ink-soft">
          추천 답장으로 바꾸면 지금 쓰던 내용은 지워져요. 이걸로 바꿀까요?
        </p>
        <p className="mb-4 rounded-xl border border-coaching-border bg-coaching-soft px-3 py-2 text-sm text-ink">
          {suggestion}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full border border-border py-2 text-sm text-ink-soft"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-full bg-accent py-2 text-sm font-medium text-canvas-raised"
          >
            바꾸기
          </button>
        </div>
      </div>
    </div>
  );
}
