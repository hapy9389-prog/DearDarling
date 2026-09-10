import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getAccount, getPartner, TEST_ACCOUNTS } from '../mocks/fixtures/accounts';
import { trialUserToTestAccount } from '../mocks/fixtures/trial';
import { createMockAuthService } from '../mocks/services/authService';
import type { TestAccount } from '../mocks/types';
import { useSession } from './SessionContext';

/**
 * `/app` 화면에서 "지금 내가 누구로 보고 있는가"와 상대를 제공한다(0010).
 *  - review 모드: 하드코딩된 민준·서연 튜플.
 *  - trial 모드: 연결된 두 체험 사용자(`TrialUser`)를 `TestAccount` 모양으로.
 * `/app`은 RequireConnected 가드 뒤라서 account·partner는 항상 존재한다.
 *
 * 저장이 필요한 데이터(설정·코칭·추억)는 이 account.id / coupleId를 키로 각 서비스가 분리한다 —
 * 시점(계정)을 바꾸면 각 Context의 "id가 바뀌면 다시 읽는다" 패턴이 그대로 동작한다.
 */
interface ActiveAccountContextValue {
  mode: 'review' | 'trial';
  account: TestAccount;
  partner: TestAccount;
  /** 화면에 표시할 두 사람. */
  accounts: readonly TestAccount[];
  /** 시점(계정) 전환 — review면 민준↔서연, trial이면 A↔B. */
  setActiveAccountId: (id: string) => void;
  /** 메시지·추억의 senderId 등을 표시용 TestAccount로. 모르는 id는 '상대' 스텁. */
  lookupMember: (userId: string) => TestAccount;
}

const ActiveAccountContext = createContext<ActiveAccountContextValue | null>(null);
const authService = createMockAuthService();

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const { session, switchReviewAccount, switchTrialPerspective } = useSession();

  const value = useMemo<ActiveAccountContextValue>(() => {
    if (session?.kind === 'trial') {
      const me = authService.getUser(session.userId);
      const partnerUser = me?.partnerUserId ? authService.getUser(me.partnerUserId) : undefined;
      if (!me || !partnerUser) {
        throw new Error('연결된 체험 커플이 아닙니다 — RequireConnected 가드가 필요합니다.');
      }
      const account = trialUserToTestAccount(me);
      const partner = trialUserToTestAccount(partnerUser);
      return {
        mode: 'trial',
        account,
        partner,
        accounts: [account, partner],
        setActiveAccountId: switchTrialPerspective,
        lookupMember: (userId) =>
          [account, partner].find((member) => member.id === userId) ?? {
            id: userId,
            nickname: '상대',
            coupleId: account.coupleId,
            avatarEmoji: '🙂',
          },
      };
    }

    // review 모드(기본): 민준·서연 튜플.
    const accountId = session?.kind === 'review' ? session.accountId : TEST_ACCOUNTS[0].id;
    const account = getAccount(accountId);
    const partner = getPartner(accountId);
    return {
      mode: 'review',
      account,
      partner,
      accounts: TEST_ACCOUNTS,
      setActiveAccountId: (id) => switchReviewAccount(id as 'user-minjun' | 'user-seoyeon'),
      lookupMember: (userId) =>
        TEST_ACCOUNTS.find((member) => member.id === userId) ?? {
          id: userId,
          nickname: '상대',
          coupleId: account.coupleId,
          avatarEmoji: '🙂',
        },
    };
  }, [session, switchReviewAccount, switchTrialPerspective]);

  return <ActiveAccountContext.Provider value={value}>{children}</ActiveAccountContext.Provider>;
}

export function useActiveAccount(): ActiveAccountContextValue {
  const ctx = useContext(ActiveAccountContext);
  if (!ctx)
    throw new Error('useActiveAccount는 ActiveAccountProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
