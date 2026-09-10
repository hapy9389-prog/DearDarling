import type { ReactNode } from 'react';

/**
 * 가입·로그인·프로필·연인 연결 등 프리-`/app` 화면의 공통 틀(0010).
 * 상단에 "가상 체험" 안내 배너를 항상 두고(실제 인증 아님), 본문은 세로 스크롤 컨테이너.
 */
export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <p className="bg-pending-soft py-2 pr-16 pl-4 text-left text-[11px] leading-relaxed text-pending">
        실제 인증이 아닌 화면 검토용 가상 체험이에요. 실제 이메일·비밀번호 대신 테스트용 값을
        쓰세요.
      </p>
      <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto px-6 py-8">{children}</div>
    </div>
  );
}
