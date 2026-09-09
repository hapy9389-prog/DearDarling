import { Avatar } from '../../shared/components/Avatar';
import type { TestAccount } from '../../mocks/types';

export function PartnerProfileHeader({ partner }: { partner: TestAccount }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-canvas-raised px-4 py-3">
      <Avatar emoji={partner.avatarEmoji} size={40} />
      <div>
        <p className="font-display text-base leading-tight">{partner.nickname}</p>
        <p className="text-xs text-ink-soft">연결된 상대</p>
      </div>
    </header>
  );
}
