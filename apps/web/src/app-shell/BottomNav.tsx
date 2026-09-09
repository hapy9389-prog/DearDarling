import { APP_TABS, useNavigation } from '../state/NavigationContext';

export function BottomNav() {
  const { screen, navigate } = useNavigation();

  return (
    <nav className="border-t border-border bg-canvas-raised px-1 pt-2 pb-[max(env(safe-area-inset-bottom),10px)]">
      <div className="flex items-stretch justify-around">
        {APP_TABS.map((tab) => {
          const active = screen === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] whitespace-nowrap ${
                active ? 'text-accent' : 'text-ink-faint'
              }`}
            >
              <span className="text-lg" aria-hidden="true">
                {tab.icon}
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
