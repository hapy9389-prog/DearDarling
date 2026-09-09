import type { ReactNode } from 'react';

export function ScreenContainer({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-[430px] flex-col bg-canvas text-ink shadow-[0_0_40px_rgba(43,33,48,0.06)]">
      {children}
    </div>
  );
}
