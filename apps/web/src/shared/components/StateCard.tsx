import type { ReactNode } from 'react';

/** 대화 목록 자리를 대신하는 상태 화면(빈 대화, AI 준비 중/장애, 동의 대기 등)에 공통으로 쓰는 카드. */
export function StateCard({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-3xl" aria-hidden="true">
        {icon}
      </div>
      <p className="font-display text-lg">{title}</p>
      <p className="text-sm leading-relaxed text-ink-soft">{description}</p>
      {action}
    </div>
  );
}
