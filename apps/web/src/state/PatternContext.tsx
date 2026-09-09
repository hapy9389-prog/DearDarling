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
  observations: PatternObservation[];
  report: WeeklyReport;
  /** 코칭 활용이 중단된 관찰 id 목록 — 대화 코칭에서 제외 대상. */
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

  const [observations, setObservations] = useState<PatternObservation[]>(() =>
    patternService.listObservations(coupleId),
  );
  const report = useMemo(() => patternService.getWeeklyReport(coupleId), [coupleId]);

  const value = useMemo<PatternContextValue>(() => {
    const excludedPatternIds = observations
      .filter(isExcludedFromCoaching)
      .map((observation) => observation.id);

    return {
      observations,
      report,
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
  }, [observations, report, coupleId, account.id]);

  return <PatternContext.Provider value={value}>{children}</PatternContext.Provider>;
}

export function usePatterns(): PatternContextValue {
  const ctx = useContext(PatternContext);
  if (!ctx) throw new Error('usePatterns는 PatternProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
