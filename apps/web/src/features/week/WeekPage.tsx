import { StateCard } from '../../shared/components/StateCard';

/**
 * 이번 주 우리 — 주간 리포트(관찰된 소통 패턴이 중심, 통계는 보조).
 * 구현 예정(0004). 지금은 자리표시자.
 */
export function WeekPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="border-b border-border bg-canvas-raised px-4 py-3">
        <p className="font-display text-lg">이번 주 우리</p>
      </header>
      <StateCard
        icon="🗓️"
        title="주간 리포트는 곧 준비돼요"
        description="지난주 대화에서 관찰한 소통 패턴을 여기서 보여줄 예정이에요. 리포트는 매주 월요일에 도착해요."
      />
    </div>
  );
}
