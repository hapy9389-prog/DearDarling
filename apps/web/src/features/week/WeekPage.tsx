import { useState, type ReactNode } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useNavigation } from '../../state/NavigationContext';
import { useScenario } from '../../state/ScenarioContext';
import { useSettings } from '../../state/SettingsContext';
import { usePatterns } from '../../state/PatternContext';
import { StateCard } from '../../shared/components/StateCard';
import type { WeeklyReportStats } from '../../mocks/types';
import { PatternObservationCard } from './PatternObservationCard';

/**
 * '우리' 탭 — 지난주 대화에서 관찰한 소통 패턴(주 콘텐츠)과 보조 통계, 그리고 개인 상담 진입점.
 * 관찰·의견·코칭 활용 중단 모델은 docs/decisions/0004를 따른다.
 *
 * 처음 화면에서 읽을 양을 줄이려고, 관찰 카드는 요약만 펼쳐두고 나머지는 카드별/하단 접힘 영역에 둔다.
 * 상태 우선순위는 대화 화면 코칭 영역과 같다: 분석 동의·철회 → AI 상태(준비 중/장애) → 대화 부족.
 * 코칭 카드 표시(coachingVisible)는 개인 표시 설정이라 이 리포트에 영향을 주지 않는다(0003 §4).
 */
export function WeekPage() {
  const { navigate } = useNavigation();
  const { account } = useActiveAccount();
  const { scenario } = useScenario();
  const settings = useSettings();
  const { observations, report } = usePatterns();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-canvas-raised px-4 py-3">
        <p className="font-display text-lg">우리</p>
        {/*
          AI 상담 진입점은 작은 버튼으로. 상세 설명(공유 리포트 vs 개인 상담, 비공개 안내)은 상담
          화면에 있다. 리포트 상태 분기 바깥이라 분석 철회·대화 부족 상태에서도 접근 가능하다.
        */}
        <button
          type="button"
          onClick={() => navigate('ask')}
          className="rounded-full border border-coaching-border bg-coaching-soft px-3 py-1.5 text-xs font-medium text-coaching"
        >
          AI에게 물어보기
        </button>
      </header>

      <ReportBody
        analysisActive={settings.coupleAnalysisActive}
        myConsent={settings.mine.analysisConsent}
        scenario={scenario}
        observationCount={observations.length}
        onOpenSettings={() => navigate('settings')}
      >
        <div className="flex flex-col gap-3 px-4 py-5">
          <div>
            <p className="eyebrow text-ink-faint">소통 패턴 관찰</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              지난주 대화에서 눈에 띈 흐름이에요. 아직 확인되지 않은 잠정 관찰이라 상대의 성향이나
              감정을 단정하지 않아요.
            </p>
          </div>

          {observations.map((observation) => (
            <PatternObservationCard key={observation.id} observation={observation} />
          ))}

          <WeeklyStatsSection stats={report.stats} />
        </div>
      </ReportBody>

      <p className="px-4 pb-6 text-center text-[11px] text-ink-faint" aria-hidden="true">
        {account.nickname}님 시점 · 매주 월요일에 새 리포트가 도착해요
      </p>
    </div>
  );
}

function ReportBody({
  analysisActive,
  myConsent,
  scenario,
  observationCount,
  onOpenSettings,
  children,
}: {
  analysisActive: boolean;
  myConsent: boolean;
  scenario: string;
  observationCount: number;
  onOpenSettings: () => void;
  children: ReactNode;
}) {
  if (!analysisActive) {
    return (
      <div className="flex flex-1 flex-col">
        <StateCard
          icon="🔒"
          title="리포트와 패턴 관찰이 중단됐어요"
          description={
            myConsent
              ? '상대방의 AI 분석 동의를 기다리고 있어요. 두 사람이 모두 동의한 기간의 대화만 분석해요.'
              : 'AI 분석에 동의하면 이번 주 리포트와 패턴 관찰을 볼 수 있어요.'
          }
          action={
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-canvas-raised"
            >
              설정에서 확인
            </button>
          }
        />
      </div>
    );
  }

  if (scenario === 'ai-warming-up') {
    return (
      <div className="flex flex-1 flex-col">
        <StateCard
          icon="⏳"
          title="이번 주 리포트를 준비하고 있어요"
          description="지난주 대화를 살펴보고 있어요. 잠시 후 다시 확인해 주세요."
        />
      </div>
    );
  }

  if (scenario === 'ai-failure') {
    return (
      <div className="flex flex-1 flex-col">
        <StateCard
          icon="⚠️"
          title="지금은 리포트를 불러올 수 없어요"
          description="일시적인 문제예요. 잠시 후 다시 시도해 주세요."
        />
      </div>
    );
  }

  if (scenario === 'empty' || observationCount === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <StateCard
          icon="💬"
          title="리포트를 만들 만큼 대화가 많지 않았어요"
          description="이번 주 대화가 더 쌓이면 다음 리포트에 관찰을 담아볼게요."
        />
      </div>
    );
  }

  return <>{children}</>;
}

function WeeklyStatsSection({ stats }: { stats: WeeklyReportStats }) {
  const [open, setOpen] = useState(false);
  const max = Math.max(1, ...stats.byWeekday.map((day) => day.count));

  return (
    <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="eyebrow text-ink-faint">이번 주 통계 · 보조 참고</span>
        <span className="text-xs text-accent">{open ? '접기' : '보기'}</span>
      </button>

      {open && (
        <div className="mt-3">
          <p className="text-sm text-ink-soft">
            주고받은 메시지{' '}
            <span className="font-medium text-ink">
              {stats.totalMessages.toLocaleString('ko-KR')}개
            </span>
          </p>

          <div className="mt-3 flex items-end gap-1.5" aria-hidden="true">
            {stats.byWeekday.map((day) => (
              <div key={day.weekday} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-accent-soft"
                  style={{ height: `${Math.round((day.count / max) * 44) + 4}px` }}
                />
                <span className="text-[10px] text-ink-faint">{day.weekday}</span>
              </div>
            ))}
          </div>

          <ul className="mt-3 flex flex-col gap-1">
            {stats.highlights.map((highlight) => (
              <li key={highlight} className="text-xs leading-relaxed text-ink-soft">
                · {highlight}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
