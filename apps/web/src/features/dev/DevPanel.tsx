import { useState } from 'react';
import { useActiveAccount } from '../../state/ActiveAccountContext';
import { SCENARIO_OPTIONS, useScenario } from '../../state/ScenarioContext';
import { usePatterns } from '../../state/PatternContext';
import { useMemories } from '../../state/MemoriesContext';
import { resetAllMockData } from '../../mocks/storage';
import { Avatar } from '../../shared/components/Avatar';

/**
 * 화면 검토용 도구 모음. 실제 제품 화면이 아니라 리뷰어가 계정/시나리오를 빠르게 바꿔보기 위한 것.
 * AI 분석 동의·코칭 카드 표시 설정은 정식 설정 화면(홈 상단 ⚙️ → 설정)으로 옮겼다.
 * 여기는 계정 전환·화면 상태 시나리오·가상 데이터 초기화만 담당한다.
 */
export function DevPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-3 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-20 flex items-center gap-1 rounded-full bg-ink px-3 py-2 text-xs text-canvas shadow-lg"
      >
        <span aria-hidden="true">🛠️</span> 검토 도구
      </button>

      {open && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end">
          <button
            type="button"
            aria-label="검토 도구 닫기"
            className="absolute inset-0 bg-ink/30"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[80%] overflow-y-auto rounded-t-2xl bg-canvas-raised p-5 shadow-2xl">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />
            <AccountSwitcherSection />
            <div className="my-4 h-px bg-border" />
            <ScenarioSection />
            <div className="my-4 h-px bg-border" />
            <WeeklyReportSection />
            <div className="my-4 h-px bg-border" />
            <MemoriesSection />
            <div className="my-4 h-px bg-border" />
            <ResetSection />
          </div>
        </div>
      )}
    </>
  );
}

function AccountSwitcherSection() {
  const { account, accounts, setActiveAccountId } = useActiveAccount();
  return (
    <section>
      <h2 className="eyebrow mb-2 text-ink-soft">테스트 계정 전환</h2>
      <div className="flex gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setActiveAccountId(a.id)}
            className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
              a.id === account.id
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-border text-ink-soft'
            }`}
          >
            <Avatar emoji={a.avatarEmoji} size={28} />
            <span>
              {a.nickname}
              {a.id === account.id && <span className="ml-1 text-xs text-accent">(현재)</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        전환하면 아직 보내지 않은 초안과 작성 중인 추억 메모는 사라져요(다른 사람에게 섞이지 않도록
        저장하지 않고 비웁니다). 이미 전송된 메시지, 코칭, 추억, 설정은 계정별로 분리되어 있어
        그대로 유지돼요.
      </p>
    </section>
  );
}

function MemoriesSection() {
  const { suggestionsPresent, rememberWhenEnabled, setSuggestionsPresent, setRememberWhenEnabled } =
    useMemories();

  return (
    <section>
      <h2 className="eyebrow mb-2 text-ink-soft">추억 · 화면 검토</h2>

      <p className="mb-1 text-xs font-medium text-ink-soft">AI가 발견한 순간</p>
      <div className="flex gap-2">
        {[
          { present: true, label: '켬' },
          { present: false, label: '끔' },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            aria-label={`AI 발견 순간 ${opt.label}`}
            onClick={() => setSuggestionsPresent(opt.present)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
              opt.present === suggestionsPresent
                ? 'border-coaching bg-coaching-soft text-coaching'
                : 'border-border text-ink-soft'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <p className="mt-3 mb-1 text-xs font-medium text-ink-soft">그때의 우리 리마인드</p>
      <div className="flex gap-2">
        {[
          { enabled: true, label: '켬' },
          { enabled: false, label: '끔' },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            aria-label={`그때의 우리 리마인드 ${opt.label}`}
            onClick={() => setRememberWhenEnabled(opt.enabled)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
              opt.enabled === rememberWhenEnabled
                ? 'border-coaching bg-coaching-soft text-coaching'
                : 'border-border text-ink-soft'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        ‘그때의 우리’를 켜면 앨범의 예시 사진 추억을 기준으로 “100일 전 오늘” 리마인드가 떠요. 그
        추억을 삭제하면 켜도 뜨지 않아요. 실제 저장 날짜·목록 정렬에는 영향을 주지 않아요.
      </p>
    </section>
  );
}

function ScenarioSection() {
  const { scenario, setScenario } = useScenario();
  return (
    <section>
      <h2 className="eyebrow mb-2 text-ink-soft">화면 상태 시나리오</h2>
      <div className="flex flex-col gap-2">
        {SCENARIO_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setScenario(opt.id)}
            className={`rounded-xl border px-3 py-2 text-left text-sm ${
              opt.id === scenario
                ? 'border-coaching bg-coaching-soft text-coaching'
                : 'border-border text-ink-soft'
            }`}
          >
            <span className="block font-medium text-ink">{opt.label}</span>
            <span className="block text-xs text-ink-soft">{opt.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function WeeklyReportSection() {
  const { weeklyFindingsPresent, setWeeklyFindingsPresent } = usePatterns();
  return (
    <section>
      <h2 className="eyebrow mb-2 text-ink-soft">주간 리포트 · 이번 주 발견</h2>
      <div className="flex gap-2">
        {[
          { present: true, label: '이번 주 발견 있음' },
          { present: false, label: '이번 주 발견 없음' },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setWeeklyFindingsPresent(opt.present)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
              opt.present === weeklyFindingsPresent
                ? 'border-coaching bg-coaching-soft text-coaching'
                : 'border-border text-ink-soft'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        ‘이번 주 발견 없음’으로 두면 관찰·대표 발견 없이 통계와 ‘눈에 띈 흐름 없음’ 안내만 보여요.
        대화 자체가 적은 ‘빈 대화’ 상태와는 다른 화면이에요.
      </p>
    </section>
  );
}

function ResetSection() {
  return (
    <section>
      <h2 className="eyebrow mb-2 text-ink-soft">데이터 초기화</h2>
      <p className="mb-2 text-xs text-ink-soft">
        두 계정의 메시지·코칭·추억·설정을 모두 처음 시드 상태로 되돌려요. 실제 서버에는 아무 영향이
        없어요(브라우저에만 저장된 가상 데이터예요).
      </p>
      <button
        type="button"
        onClick={() => {
          if (window.confirm('가상 데이터를 모두 초기 상태로 되돌릴까요?')) {
            resetAllMockData();
            window.location.reload();
          }
        }}
        className="w-full rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
      >
        가상 데이터 초기화
      </button>
    </section>
  );
}
