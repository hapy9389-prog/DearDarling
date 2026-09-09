import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_ACCOUNT_ID,
  TEST_ACCOUNTS,
  getAccount,
  getPartner,
} from '../mocks/fixtures/accounts';
import { devKey, readJSON, writeJSON } from '../mocks/storage';
import type { TestAccount } from '../mocks/types';

/**
 * "지금 내가 어느 테스트 계정으로 화면을 보고 있는가"만 담당한다.
 * 저장이 필요한 데이터(설정·코칭)는 이 계정 ID를 키로 삼아 각 서비스/Context가 알아서 분리해 둔다 —
 * 여기서 직접 데이터를 들고 있지 않으므로 계정을 바꿔도 이 컨텍스트 자체에 섞일 데이터가 없다.
 * 반면 아직 보내지 않은 입력창 초안은 애초에 저장하지 않는다 — ChatPage가 계정 전환 시
 * 그냥 비워서, 한 사람이 쓰던 내용이 다른 사람 화면에 남아있지 않도록 한다.
 */
interface ActiveAccountContextValue {
  account: TestAccount;
  partner: TestAccount;
  accounts: readonly TestAccount[];
  setActiveAccountId: (id: string) => void;
}

const ActiveAccountContext = createContext<ActiveAccountContextValue | null>(null);
const ACTIVE_ACCOUNT_KEY = devKey('activeAccountId');

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string>(() =>
    readJSON<string>(ACTIVE_ACCOUNT_KEY, DEFAULT_ACCOUNT_ID),
  );

  const value = useMemo<ActiveAccountContextValue>(() => {
    const account = getAccount(accountId);
    const partner = getPartner(accountId);
    return {
      account,
      partner,
      accounts: TEST_ACCOUNTS,
      setActiveAccountId: (id: string) => {
        writeJSON(ACTIVE_ACCOUNT_KEY, id);
        setAccountId(id);
      },
    };
  }, [accountId]);

  return <ActiveAccountContext.Provider value={value}>{children}</ActiveAccountContext.Provider>;
}

export function useActiveAccount(): ActiveAccountContextValue {
  const ctx = useContext(ActiveAccountContext);
  if (!ctx)
    throw new Error('useActiveAccount는 ActiveAccountProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
