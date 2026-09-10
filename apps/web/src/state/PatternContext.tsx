import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createMockPatternService } from '../mocks/services/patternService';
import { isExcludedFromCoaching } from '../mocks/domain/patterns';
import type { PatternObservation, WeeklyReport } from '../mocks/types';
import { useActiveAccount } from './ActiveAccountContext';

const patternService = createMockPatternService();

/**
 * 주간 패턴 관찰·의견·코칭 활용 중단을 전역으로 들고 있는 컨텍스트.
 *
 * '우리' 탭은 열 때마다 다시 마운트되지만(0003 §3), **대화 화면은 상시 마운트**라서 '우리' 탭에서
 * 코칭 활용 중단을 토글해도 대화 화면이 스스로 갱신되지 않는다. 설정↔대화와 똑같은 상황이므로
 * (SettingsContext와 동일하게) 전역 컨텍스트로 두 화면이 같은 상태를 본다.
 */
interface PatternContextValue {
  /** 이번 주 관찰. 검토 도구로 '발견 없음'을 켜면 빈 배열이 된다. */
  observations: PatternObservation[];
  report: WeeklyReport;
  /** 이번 주 대표 발견(0007). 없으면 null — 이때도 통계는 보인다. */
  headlineObservation: PatternObservation | null;
  /** 대표 발견을 뺀 나머지 관찰. 대표가 없으면 전체(기존 순서 유지). */
  otherObservations: PatternObservation[];
  /**
   * 검토 도구용: 끄면 이번 주 관찰·대표 발견이 모두 없는 상태를 확인한다(새로고침 시 초기화).
   * 관찰 0건이어도 통계와 '눈에 띈 흐름 없음' 안내는 유지된다 — '대화 부족'과는 다른 화면(0007).
   */
  weeklyFindingsPresent: boolean;
  setWeeklyFindingsPresent: (present: boolean) => void;
  /**
   * 코칭 활용이 중단된 관찰 id 목록 — 대화 코칭에서 제외 대상. 저장된 제외 설정으로만 계산하므로
   * 검토용 `weeklyFindingsPresent`(리포트 표시 여부)에 영향받지 않는다.
   */
  excludedPatternIds: string[];
  addOpinion: (observationId: string, text: string) => void;
  editOpinion: (observationId: string, opinionId: string, text: string) => void;
  removeOpinion: (observationId: string, opinionId: string) => void;
  optOut: (observationId: string) => void;
  revokeOwnOptOut: (observationId: string) => void;
}

const PatternContext = createContext<PatternContextValue | null>(null);

export function PatternProvider({ children }: { children: ReactNode }) {
  const { account } = useActiveAccount();
  const coupleId = account.coupleId;

  const [storedObservations, setObservations] = useState<PatternObservation[]>(() =>
    patternService.listObservations(coupleId),
  );

  // 커플(또는 모드)이 바뀌면 이전 커플의 관찰이 남지 않도록 다시 불러온다.
  const [loadedCoupleId, setLoadedCoupleId] = useState(coupleId);
  if (loadedCoupleId !== coupleId) {
    setLoadedCoupleId(coupleId);
    setObservations(patternService.listObservations(coupleId));
  }

  // 검토 커플의 리포트는 고정 시드. (체험 커플의 최신 통계는 PatternProvider가 탭 이동만으로는
  // 리렌더되지 않으므로 WeekPage가 열릴 때 직접 다시 읽는다 — 0010.)
  const report = useMemo(() => patternService.getWeeklyReport(coupleId), [coupleId]);
  const [weeklyFindingsPresent, setWeeklyFindingsPresent] = useState(true);

  const value = useMemo<PatternContextValue>(() => {
    // 리포트 표시용 관찰 목록: '발견 없음'을 켜면 관찰이 하나도 없는 주를 흉내 낸다
    // (통계·안내는 WeekPage가 계속 보여준다).
    const observations = weeklyFindingsPresent ? storedObservations : [];

    // 코칭 제외 목록은 **저장된 관찰**(storedObservations)의 제외 설정으로만 계산한다 — 검토용
    // '발견 없음' 토글이 이미 제외한 관찰의 코칭 숨김을 되돌리지 않도록(리포트 표시 ≠ 제외 설정).
    const excludedPatternIds = storedObservations
      .filter(isExcludedFromCoaching)
      .map((observation) => observation.id);

    const headlineObservation = report.headlineObservationId
      ? (observations.find((o) => o.id === report.headlineObservationId) ?? null)
      : null;
    const otherObservations = headlineObservation
      ? observations.filter((o) => o.id !== headlineObservation.id)
      : observations;

    return {
      observations,
      report,
      headlineObservation,
      otherObservations,
      weeklyFindingsPresent,
      setWeeklyFindingsPresent,
      excludedPatternIds,
      addOpinion: (observationId, text) =>
        setObservations(
          patternService.addOpinion({ coupleId, observationId, authorId: account.id, text }),
        ),
      editOpinion: (observationId, opinionId, text) =>
        setObservations(
          patternService.editOpinion({
            coupleId,
            observationId,
            opinionId,
            authorId: account.id,
            text,
          }),
        ),
      removeOpinion: (observationId, opinionId) =>
        setObservations(
          patternService.removeOpinion({
            coupleId,
            observationId,
            opinionId,
            authorId: account.id,
          }),
        ),
      optOut: (observationId) =>
        setObservations(
          patternService.optOutOfCoaching({ coupleId, observationId, userId: account.id }),
        ),
      revokeOwnOptOut: (observationId) =>
        setObservations(
          patternService.revokeOwnOptOut({ coupleId, observationId, userId: account.id }),
        ),
    };
  }, [storedObservations, report, weeklyFindingsPresent, coupleId, account.id]);

  return <PatternContext.Provider value={value}>{children}</PatternContext.Provider>;
}

export function usePatterns(): PatternContextValue {
  const ctx = useContext(PatternContext);
  if (!ctx) throw new Error('usePatterns는 PatternProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
