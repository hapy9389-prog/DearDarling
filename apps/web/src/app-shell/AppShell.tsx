import type { ReactNode } from 'react';
import { MockModeBanner } from './MockModeBanner';
import { BottomNav } from './BottomNav';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <MockModeBanner />
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      <BottomNav />
    </div>
  );
}
