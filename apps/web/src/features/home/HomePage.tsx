import { useMemo } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useScenario } from '../../state/ScenarioContext';
import { useSettings } from '../../state/SettingsContext';
import { useNavigation } from '../../state/NavigationContext';
import { createMockRelationshipService } from '../../mocks/services/relationshipService';
import { daysTogether } from '../../mocks/domain/relationship';

export function HomePage() {
  const { account, partner } = useActiveAccount();
  const { scenario } = useScenario();
  const settings = useSettings();
  const { navigate } = useNavigation();

  const relationship = useMemo(() => createMockRelationshipService(), []);
  const profile = relationship.getCoupleProfile(account.coupleId);
  const days = daysTogether(profile.relationshipStartDate);

  const analysisActive = settings.coupleAnalysisActive;
  // 화면 검토용: '빈 대화' 시나리오를 "오늘 나눈 대화가 없는 상태"로 본다(0003).
  const noConversationToday = scenario === 'empty';

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex items-center justify-between border-b border-border bg-canvas-raised px-4 py-3">
        <p className="font-display text-lg">DearDarling</p>
        <button
          type="button"
          onClick={() => navigate('settings')}
          aria-label="설정"
          className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
        >
          <span aria-hidden="true">⚙️</span>
        </button>
      </header>

      <div className="flex flex-col gap-4 px-4 py-5">
        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-5 text-center">
          <p className="eyebrow text-ink-faint">{partner.nickname}님과</p>
          <p className="mt-1 font-display text-2xl">함께한 지 {days.toLocaleString('ko-KR')}일</p>
        </section>

        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
          <p className="eyebrow mb-2 text-ink-faint">오늘의 대화</p>
          {!analysisActive ? (
            <p className="text-sm leading-relaxed text-ink-soft">
              AI 분석이 중단되어 오늘 요약을 만들지 않아요.{' '}
              <button
                type="button"
                onClick={() => navigate('settings')}
                className="text-accent underline"
              >
                설정에서 다시 켜기
              </button>
            </p>
          ) : noConversationToday ? (
            <p className="text-sm leading-relaxed text-ink-soft">
              오늘은 아직 나눈 대화가 없어요.{' '}
              <button
                type="button"
                onClick={() => navigate('chat')}
                className="text-accent underline"
              >
                {partner.nickname}님에게 말 걸기
              </button>
            </p>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-ink">
                {relationship.getTodaySummary(account.coupleId)}
              </p>
              <span className="eyebrow mt-2 inline-block rounded-full bg-pending-soft px-2 py-0.5 text-pending">
                예시
              </span>
            </>
          )}
        </section>

        <button
          type="button"
          onClick={() => analysisActive && navigate('week')}
          className="rounded-2xl border border-border bg-canvas-raised px-4 py-4 text-left"
        >
          <p className="eyebrow mb-1 text-ink-faint">이번 주 우리</p>
          {analysisActive ? (
            <p className="text-sm leading-relaxed text-ink-soft">
              지난주 대화 리포트는 매주 월요일에 도착해요.{' '}
              <span className="text-accent">이번 주 리포트 보기 →</span>
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-ink-soft">
              AI 분석이 중단되어 리포트가 생성되지 않아요.
            </p>
          )}
        </button>

        <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="eyebrow text-ink-faint">최근 추억</p>
            <button
              type="button"
              onClick={() => navigate('memories')}
              className="text-xs text-accent"
            >
              더 보기
            </button>
          </div>
          <p className="text-sm leading-relaxed text-ink-soft">
            아직 저장한 추억이 없어요. 대화에서 소중한 순간을 저장해 보세요.
          </p>
        </section>
      </div>
    </div>
  );
}
