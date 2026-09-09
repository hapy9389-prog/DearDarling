export function ConnectionStatusBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-danger-soft bg-danger-soft px-4 py-2 text-sm text-danger">
      <span aria-hidden="true">⚠️</span>
      <span>연결이 끊겼어요. 메시지는 다시 연결되면 전송돼요.</span>
    </div>
  );
}
