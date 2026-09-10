export function MockModeBanner() {
  return (
    // 오른쪽 여백(pr-16)은 검토 도구 버튼(DevPanel이 이 줄 위에 절대 배치) 자리를 비워 둔 것.
    <div className="flex items-center gap-2 border-b border-pending-soft bg-pending-soft py-1.5 pr-16 pl-4">
      <span aria-hidden="true">🧪</span>
      <p className="eyebrow text-pending">가상 데이터로 동작하는 화면 검토용입니다</p>
    </div>
  );
}
