import { StateCard } from '../../shared/components/StateCard';

/**
 * 추억 — 직접 저장한 대화와 메모(커플 공유). 구현 예정(0003). 지금은 자리표시자.
 */
export function MemoriesPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="border-b border-border bg-canvas-raised px-4 py-3">
        <p className="font-display text-lg">추억</p>
      </header>
      <StateCard
        icon="📷"
        title="추억 화면 준비 중"
        description="대화에서 소중한 메시지를 골라 저장하거나 메모를 남겨 두 사람이 함께 볼 수 있게 할 예정이에요."
      />
    </div>
  );
}
