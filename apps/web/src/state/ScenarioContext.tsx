import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { devKey, readJSON, writeJSON } from '../mocks/storage';
import type { ChatDevScenario } from '../mocks/types';

export const SCENARIO_OPTIONS: { id: ChatDevScenario; label: string; description: string }[] = [
  {
    id: 'happy-path',
    label: '정상',
    description: '평범한 대화 + 코칭 제안이 있는 기본 상태 (연결 끊김·AI 상태와 같은 대화 공유)',
  },
  {
    id: 'empty',
    label: '빈 대화',
    description:
      '이 화면에 들어올 때마다 항상 빈 상태로 시작해요. 보낸 메시지는 다른 시나리오로 넘어가면 사라져요.',
  },
  { id: 'ai-warming-up', label: 'AI 준비 중', description: '코칭이 아직 준비되지 않은 상태' },
  { id: 'ai-failure', label: 'AI 장애', description: '코칭 요청이 실패하는 상태' },
  {
    id: 'disconnected',
    label: '연결 끊김',
    description:
      '전송이 계속 실패하는 상태. "정상"으로 돌아오면 같은 대화 안에서 재전송할 수 있어요.',
  },
];

interface ScenarioContextValue {
  scenario: ChatDevScenario;
  setScenario: (scenario: ChatDevScenario) => void;
}

const ScenarioContext = createContext<ScenarioContextValue | null>(null);
const SCENARIO_KEY = devKey('scenario');

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenarioState] = useState<ChatDevScenario>(() =>
    readJSON<ChatDevScenario>(SCENARIO_KEY, 'happy-path'),
  );

  const value = useMemo<ScenarioContextValue>(
    () => ({
      scenario,
      setScenario: (next) => {
        writeJSON(SCENARIO_KEY, next);
        setScenarioState(next);
      },
    }),
    [scenario],
  );

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenario(): ScenarioContextValue {
  const ctx = useContext(ScenarioContext);
  if (!ctx) throw new Error('useScenario는 ScenarioProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
