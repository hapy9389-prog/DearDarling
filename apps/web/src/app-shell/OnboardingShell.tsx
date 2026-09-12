import type { ReactNode } from 'react';

/**
 * 가입·로그인·프로필·연인 연결 등 프리-`/app` 화면의 공통 틀(0010).
 * `mock`(기본 true)이면 상단에 "가상 체험" 안내 배너를 둔다(실제 인증 아님) — trial(체험)·
 * review(검토) 전용 화면에서만 켠다. `/signup`·`/login`·`/reset`·`/real/*`처럼 실제 Cognito
 * 계정이 쓰는 화면에는 `mock={false}`를 넘겨 이 배너를 빼야 한다 — 실제 이메일·비밀번호를
 * 쓰는 화면에서 "가짜예요"라고 안내하면 안 된다.
 */
export function OnboardingShell({
  children,
  mock = true,
}: {
  children: ReactNode;
  mock?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {mock && (
        <p className="bg-pending-soft py-2 pr-16 pl-4 text-left text-[11px] leading-relaxed text-pending">
          실제 인증이 아닌 화면 검토용 가상 체험이에요. 실제 이메일·비밀번호 대신 테스트용 값을
          쓰세요.
        </p>
      )}
      <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto px-6 py-8">{children}</div>
    </div>
  );
}
