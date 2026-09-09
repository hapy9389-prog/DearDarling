import { useState } from 'react';

const TABS = [
  { id: 'chat', label: '대화', icon: '💬', enabled: true },
  { id: 'report', label: '이번 주 우리', icon: '🗓️', enabled: false },
  { id: 'settings', label: '설정', icon: '⚙️', enabled: false },
] as const;

export function BottomNav() {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <nav className="relative border-t border-border bg-canvas-raised px-2 pt-2 pb-[max(env(safe-area-inset-bottom),10px)]">
      {notice && (
        <p
          role="status"
          className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-xs whitespace-nowrap text-canvas shadow-sm"
        >
          {notice}
        </p>
      )}
      <div className="flex items-center justify-around">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex flex-col items-center gap-0.5 rounded-lg px-4 py-1.5 text-xs ${
              tab.enabled ? 'text-ink' : 'text-ink-faint'
            }`}
            aria-current={tab.enabled ? 'page' : undefined}
            onClick={() => {
              if (tab.enabled) return;
              setNotice(`${tab.label} 화면은 다음 단계에서 추가돼요`);
              window.setTimeout(() => setNotice(null), 1800);
            }}
          >
            <span className="text-lg" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
