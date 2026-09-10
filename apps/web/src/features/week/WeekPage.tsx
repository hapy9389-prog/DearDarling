import { useMemo, useState, type ReactNode } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useNavigation } from '../../state/NavigationContext';
import { useScenario } from '../../state/ScenarioContext';
import { useSettings } from '../../state/SettingsContext';
import { usePatterns } from '../../state/PatternContext';
import { createMockPatternService } from '../../mocks/services/patternService';
import { StateCard } from '../../shared/components/StateCard';
import type { PatternObservation, WeeklyReportStats } from '../../mocks/types';
import { HeadlineFinding } from './HeadlineFinding';
import { PatternObservationCard } from './PatternObservationCard';

/**
 * '대화 부족'은 대화 자체가 적어 리포트를 못 만드는 경우다 — `scenario === 'empty'`로만 판단한다.
 * 관찰이 0건인 것만으로는 '대화 부족'이 아니다: 대화·통계가 충분해도 이번 주에 눈에 띈 관찰이
 * 없을 수 있으므로, 이때는 통계와 '눈에 띈 흐름 없음' 안내를 유지한다(0007).
 */
const NOT_ENOUGH_CONVERSATION_SCENARIO = 'empty';

/**
 * '우리' 탭 — 이번 주의 핵심 발견 하나를 중심으로 읽는 주간 리포트(docs/decisions/0007).
 * 위에서 아래로: 상단 안내 한 번 → 핵심 통계 + 작은 그래프 → 이번 주 대표 발견 하나 →
 * '다른 발견 보기'(접힘). 헤더에는 AI 개인 상담 진입점.
 *
 * - 반복되던 '미확인 가설' 칩 대신 상단에서 한 번만 잠정 안내를 한다.
 * - 관찰·의견·코칭 제외 모델은 0004를 따른다 — 의견이 없거나 두 사람이 남겨도 관찰을 확정된
 *   사실로 바꾸지 않는다. 제외된 관찰은 실천 제안·양측 대화 코칭에서 계속 빠진다.
 * - 상태 우선순위는 대화 화면 코칭 영역과 같다: 분석 동의·철회 → AI 상태(준비 중/장애) → 대화 부족.
 *   '대화 부족'은 `scenario === 'empty'`로만 판단한다. 대화·통계가 충분한데 이번 주에 관찰·대표
 *   발견이 없는 경우는 '대화 부족'이 아니라 통계 + '눈에 띈 흐름 없음' 안내를 유지한다.
 * - 코칭 카드 표시(coachingVisible)는 개인 표시 설정이라 이 리포트에 영향을 주지 않는다(0003 §4).
 */
export function WeekPage() {
  const { navigate } = useNavigation();
  const { account, mode } = useActiveAccount();
  const { scenario } = useScenario();
  const settings = useSettings();
  const { report, headlineObservation, otherObservations } = usePatterns();

  const header = (
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
  );

  // 신규 체험: AI 분석·주간 발견을 제공하지 않는다(0010). 대화가 없으면 시작 안내, 있으면 통계만.
  // 통계는 저장된 대화에서 파생하므로, 탭을 열 때마다(WeekPage 재마운트) 여기서 직접 최신값을 읽는다
  // — PatternProvider는 탭 이동만으로는 리렌더되지 않아 컨텍스트의 report가 뒤처질 수 있다.
  if (mode === 'trial') {
    return (
      <TrialWeek header={header} coupleId={account.coupleId} onOpenChat={() => navigate('chat')} />
    );
  }

  return (
    <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
      {header}

      <ReportBody
        analysisActive={settings.coupleAnalysisActive}
        myConsent={settings.mine.analysisConsent}
        scenario={scenario}
        onOpenSettings={() => navigate('settings')}
      >
        <div className="flex flex-col gap-4 px-4 py-5">
          <p className="rounded-2xl border border-border bg-canvas-raised px-4 py-3 text-xs leading-relaxed text-ink-soft">
            대화에서 이런 모습이 보였어요. 두 사람이 느낀 것과는 다를 수 있어요.
          </p>

          <WeeklyStatsStrip stats={report.stats} />

          {headlineObservation ? (
            <HeadlineFinding observation={headlineObservation} />
          ) : otherObservations.length === 0 ? (
            <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
              <p className="eyebrow text-ink-faint">이번 주 눈에 띈 우리 모습</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                이번 주는 특별히 눈에 띈 흐름은 없었어요. 도움이 될 관찰이 있으면 다음 리포트에
                담을게요.
              </p>
            </section>
          ) : null}

          {otherObservations.length > 0 && <OtherFindings observations={otherObservations} />}
        </div>
      </ReportBody>

      <p className="px-4 pb-6 text-center text-[11px] text-ink-faint" aria-hidden="true">
        {account.nickname}님 시점 · 매주 월요일에 새 리포트가 도착해요
      </p>
    </div>
  );
}

/**
 * 신규 체험 커플의 '우리' 탭(0010). AI 분석·주간 발견은 없고, 통계만 저장된 대화에서 만든다.
 * WeekPage가 탭을 열 때마다 다시 마운트되므로 여기서 서비스를 직접 읽어 최신 통계를 보장한다.
 */
function TrialWeek({
  header,
  coupleId,
  onOpenChat,
}: {
  header: ReactNode;
  coupleId: string;
  onOpenChat: () => void;
}) {
  const stats = useMemo(
    () => createMockPatternService().getWeeklyReport(coupleId).stats,
    [coupleId],
  );

  return (
    <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
      {header}
      {stats.totalMessages === 0 ? (
        <div className="flex flex-1 flex-col">
          <StateCard
            icon="💬"
            title="아직 나눈 대화가 없어요"
            description="대화를 시작하면 이번 주 통계가 여기에 쌓여요."
            action={
              <button
                type="button"
                onClick={onOpenChat}
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-canvas-raised"
              >
                대화로 이동
              </button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-4 py-5">
          <WeeklyStatsStrip stats={stats} />
          <p className="rounded-2xl border border-border bg-canvas-raised px-4 py-3 text-xs leading-relaxed text-ink-soft">
            이번 체험에서는 AI 분석 결과(주간 발견·코칭)를 제공하지 않아요. 위 통계는 이번 주에
            실제로 주고받은 메시지를 바탕으로 해요.
          </p>
        </div>
      )}
    </div>
  );
}

function ReportBody({
  analysisActive,
  myConsent,
  scenario,
  onOpenSettings,
  children,
}: {
  analysisActive: boolean;
  myConsent: boolean;
  scenario: string;
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

  if (scenario === NOT_ENOUGH_CONVERSATION_SCENARIO) {
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

/** 상단 핵심 통계 3개 + 요일별 작은 막대 그래프 + 하이라이트. 관계 점수·순위는 넣지 않는다. */
function WeeklyStatsStrip({ stats }: { stats: WeeklyReportStats }) {
  const max = Math.max(1, ...stats.byWeekday.map((day) => day.count));
  const busiest = stats.byWeekday.reduce((top, day) => (day.count > top.count ? day : top));

  const tiles = [
    { label: '주고받은 메시지', value: `${stats.totalMessages.toLocaleString('ko-KR')}개` },
    {
      label: '대화한 날',
      value:
        stats.daysWithConversation >= stats.activeDaysTotal
          ? '매일'
          : `${stats.daysWithConversation}일`,
    },
    { label: '많았던 요일', value: `${busiest.weekday}요일` },
  ];

  return (
    <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
      <p className="eyebrow text-ink-faint">이번 주 통계</p>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl bg-canvas px-2 py-2 text-center">
            <p className="text-sm font-medium text-ink">{tile.value}</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">{tile.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-end gap-1.5" aria-hidden="true">
        {stats.byWeekday.map((day) => (
          <div key={day.weekday} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-accent-soft"
              style={{ height: `${Math.round((day.count / max) * 40) + 4}px` }}
            />
            <span className="text-[10px] text-ink-faint">{day.weekday}</span>
          </div>
        ))}
      </div>

      {stats.highlights.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {stats.highlights.map((highlight) => (
            <li key={highlight} className="text-xs leading-relaxed text-ink-soft">
              · {highlight}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 대표 발견을 뺀 나머지 관찰. 기본은 접힘 — 펼치면 카드별로 의견·코칭 제외 조작을 할 수 있다. */
function OtherFindings({ observations }: { observations: PatternObservation[] }) {
  const { account } = useActiveAccount();
  const [open, setOpen] = useState(false);

  // 계정을 전환하면 접는다(카드 내부도 각자 접힌다).
  const [listAccountId, setListAccountId] = useState(account.id);
  if (listAccountId !== account.id) {
    setListAccountId(account.id);
    setOpen(false);
  }

  return (
    <section className="rounded-2xl border border-border bg-canvas-raised px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="eyebrow text-ink-faint">다른 발견 보기 · {observations.length}</span>
        <span className="text-xs text-accent">{open ? '접기' : '보기'}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {observations.map((observation) => (
            <PatternObservationCard key={observation.id} observation={observation} />
          ))}
        </div>
      )}
    </section>
  );
}
