export function MockModeBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-pending-soft bg-pending-soft px-4 py-1.5">
      <span aria-hidden="true">🧪</span>
      <p className="eyebrow text-pending">가상 데이터로 동작하는 화면 검토용입니다</p>
    </div>
  );
}
