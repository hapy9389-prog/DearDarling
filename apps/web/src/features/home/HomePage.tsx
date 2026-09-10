import { useMemo } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { useScenario } from '../../state/ScenarioContext';
import { useSettings } from '../../state/SettingsContext';
import { useNavigation } from '../../state/NavigationContext';
import { useMemories } from '../../state/MemoriesContext';
import { usePatterns } from '../../state/PatternContext';
import { createMockRelationshipService } from '../../mocks/services/relationshipService';
import { daysTogether } from '../../mocks/domain/relationship';
import { memoryImages } from '../../mocks/domain/memories';
import { hadSavedMessageToday } from '../../mocks/domain/weeklyReport';
import { coupleKey, readJSON } from '../../mocks/storage';
import type { ChatMessage } from '../../mocks/types';
import { Avatar } from '../../shared/components/Avatar';
import { ExampleImage } from '../memories/ExampleImage';

/**
 * 홈 — '오늘의 우리' 한 화면(0009). 비슷한 크기의 테두리 상자 목록 대신 위계를 준다:
 *  ① 대표 영역: 두 사람 프로필 · 함께한 날짜 · 오늘의 한 줄.
 *  ② 작은 바로가기: 이번 주 대표 발견 제목 → '우리' 탭.
 *  ③ 이미지 영역: 최근 추억(이미지가 있으면 사진, 없으면 글 중심).
 *
 * 요약·리포트 미리보기는 연결되는 화면(대화 코칭 / '우리')과 모순되지 않게 상태를 구분한다
 * (분석 철회 / 대화 부족 / AI 준비 중·장애 / 발견 없음). 관계 온도·점수는 넣지 않는다(0005 보류).
 * 홈은 usePatterns()·useScenario()·useSettings()만 읽고 대표 발견·추억 데이터를 따로 관리하지 않는다.
 */
export function HomePage() {
  const { account, partner, lookupMember, mode } = useActiveAccount();
  const { scenario } = useScenario();
  const settings = useSettings();
  const { navigate } = useNavigation();
  const { memories } = useMemories();
  const { headlineObservation } = usePatterns();

  const relationship = useMemo(() => createMockRelationshipService(), []);
  const profile = relationship.getCoupleProfile(account.coupleId);
  // 연애 시작일은 선택 입력이라 없을 수 있다(0010) — 이때는 "함께한 지 N일"을 만들지 않는다.
  const days = profile.relationshipStartDate ? daysTogether(profile.relationshipStartDate) : null;

  const analysisActive = settings.coupleAnalysisActive;
  const recentMemories = memories.slice(0, 2);
  const trial = mode === 'trial';
  const talkedToday =
    trial &&
    hadSavedMessageToday(readJSON<ChatMessage[]>(coupleKey(account.coupleId, 'messages'), []));

  return (
    <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto">
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

      <div className="flex flex-col gap-5 px-4 py-5">
        {/* ① 대표 영역 — 오늘의 우리 (크게, 여백 넉넉히, 따뜻한 톤) */}
        <section className="rounded-3xl border border-accent-soft bg-canvas-raised px-5 py-6">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <Avatar emoji={account.avatarEmoji} size={40} />
              <Avatar emoji={partner.avatarEmoji} size={40} />
            </div>
            <div>
              <p className="text-sm font-medium text-ink">
                {account.nickname} · {partner.nickname}
              </p>
              <p className="eyebrow text-ink-faint">
                {days !== null
                  ? `함께한 지 ${days.toLocaleString('ko-KR')}일`
                  : '사귀기 시작한 날을 설정에서 더할 수 있어요'}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="eyebrow mb-1.5 text-ink-faint">오늘의 우리</p>
            <TodayLine
              trial={trial}
              talkedToday={talkedToday}
              analysisActive={analysisActive}
              scenario={scenario}
              summary={relationship.getTodaySummary(account.coupleId)}
              partnerNickname={partner.nickname}
              onOpenSettings={() => navigate('settings')}
              onOpenChat={() => navigate('chat')}
            />
          </div>
        </section>

        {/* ② 작은 바로가기 — 우리 리포트 (대표 영역보다 작게) */}
        <button
          type="button"
          onClick={() => navigate('week')}
          aria-label="이번 주 우리 리포트 보기"
          className="rounded-2xl border border-border bg-canvas-raised px-4 py-3 text-left"
        >
          <p className="eyebrow mb-1 text-ink-faint">우리</p>
          <ReportPreview
            trial={mode === 'trial'}
            analysisActive={analysisActive}
            scenario={scenario}
            headlineTitle={headlineObservation?.title ?? null}
            hasHeadline={headlineObservation !== null}
          />
        </button>

        {/* ③ 이미지 영역 — 최근 추억 (다른 리듬: 이미지 우선) */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow text-ink-faint">최근 추억</p>
            <button
              type="button"
              onClick={() => navigate('memories')}
              className="text-xs text-accent"
            >
              더 보기
            </button>
          </div>

          {recentMemories.length === 0 ? (
            <div className="rounded-2xl border border-border bg-canvas-raised px-4 py-4">
              <p className="text-sm leading-relaxed text-ink-soft">
                아직 저장한 추억이 없어요. 대화에서 소중한 순간을 저장해 보세요.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {recentMemories.map((memory) => {
                const image = memoryImages(memory)[0];
                return (
                  <li key={memory.id}>
                    <button
                      type="button"
                      onClick={() => navigate('memories', { memoryId: memory.id })}
                      className="block w-full overflow-hidden rounded-2xl border border-border bg-canvas-raised text-left"
                    >
                      {image && <ExampleImage image={image} size="card" />}
                      <div className="px-4 py-3">
                        <p className="border-l-2 border-border pl-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft italic">
                          {memory.quoteBody}
                        </p>
                        <p className="mt-1 text-[11px] text-ink-faint">
                          {memory.note ? `${memory.note} · ` : ''}
                          {lookupMember(memory.quoteSenderId).nickname}의 말 ·{' '}
                          {lookupMember(memory.savedByUserId).nickname} 저장
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * 오늘의 한 줄. 대화 코칭·'우리' 화면과 같은 우선순위로 상태를 구분한다
 * (분석 철회 → 대화 부족 → AI 준비 중 → AI 장애 → 실제 요약 예시).
 */
function TodayLine({
  trial,
  talkedToday,
  analysisActive,
  scenario,
  summary,
  partnerNickname,
  onOpenSettings,
  onOpenChat,
}: {
  trial: boolean;
  talkedToday: boolean;
  analysisActive: boolean;
  scenario: string;
  summary: string | null;
  partnerNickname: string;
  onOpenSettings: () => void;
  onOpenChat: () => void;
}) {
  // 체험 커플: AI 분석 결과를 아예 제공하지 않는다(0010). "분석했지만 못 찾았다"고 말하지 않는다.
  // 오늘 대화 여부(오늘 saved 메시지)와 주간 통계 기간은 별개로 다룬다.
  if (trial) {
    if (!talkedToday) {
      return (
        <p className="text-sm leading-relaxed text-ink-soft">
          오늘은 아직 나눈 대화가 없어요.{' '}
          <button type="button" onClick={onOpenChat} className="text-accent underline">
            {partnerNickname}님에게 말 걸기
          </button>
        </p>
      );
    }
    return (
      <>
        <p className="text-sm leading-relaxed text-ink">오늘도 이야기를 나눴어요.</p>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          이번 체험에서는 AI 요약을 제공하지 않아요.
        </p>
      </>
    );
  }
  if (!analysisActive) {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        AI 분석이 중단되어 오늘 요약을 만들지 않아요.{' '}
        <button type="button" onClick={onOpenSettings} className="text-accent underline">
          설정에서 다시 켜기
        </button>
      </p>
    );
  }
  if (scenario === 'empty') {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        오늘은 아직 나눈 대화가 없어요.{' '}
        <button type="button" onClick={onOpenChat} className="text-accent underline">
          {partnerNickname}님에게 말 걸기
        </button>
      </p>
    );
  }
  if (scenario === 'ai-warming-up') {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        오늘 대화를 살펴보고 있어요. 잠시 후 다시 확인해 주세요.
      </p>
    );
  }
  if (scenario === 'ai-failure') {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">지금은 오늘 요약을 불러올 수 없어요.</p>
    );
  }
  return (
    <>
      <p className="text-sm leading-relaxed text-ink">{summary}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
        <span className="eyebrow rounded-full bg-pending-soft px-2 py-0.5 text-pending">예시</span>
        AI 요약 예시예요 · 실제 분석 결과가 아니에요
      </p>
    </>
  );
}

/** 우리 리포트 미리보기 — WeekPage의 ReportBody 게이팅과 같은 우선순위·문구를 맞춘다. */
function ReportPreview({
  trial,
  analysisActive,
  scenario,
  headlineTitle,
  hasHeadline,
}: {
  trial: boolean;
  analysisActive: boolean;
  scenario: string;
  headlineTitle: string | null;
  hasHeadline: boolean;
}) {
  const link = <span className="text-accent">우리 탭에서 보기 →</span>;

  if (trial) {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        이번 체험에서는 주간 리포트를 제공하지 않아요. 우리 탭에서 대화 통계만 볼 수 있어요. {link}
      </p>
    );
  }
  if (!analysisActive) {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        AI 분석이 중단되어 리포트가 생성되지 않아요. {link}
      </p>
    );
  }
  if (scenario === 'ai-warming-up') {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        이번 주 리포트를 준비하고 있어요. {link}
      </p>
    );
  }
  if (scenario === 'ai-failure') {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        지금은 리포트를 불러올 수 없어요. {link}
      </p>
    );
  }
  if (scenario === 'empty') {
    return (
      <p className="text-sm leading-relaxed text-ink-soft">
        리포트를 만들 만큼 대화가 많지 않았어요. {link}
      </p>
    );
  }
  if (hasHeadline) {
    return (
      <>
        <p className="text-sm leading-relaxed text-ink">
          이번 주 발견 · {headlineTitle ?? '이번 주 눈에 띈 흐름'}
        </p>
        <p className="mt-1 text-xs text-ink-faint">매주 월요일에 새 리포트가 도착해요. {link}</p>
      </>
    );
  }
  return (
    <p className="text-sm leading-relaxed text-ink-soft">
      이번 주는 특별히 눈에 띈 흐름은 없었어요. {link}
    </p>
  );
}
