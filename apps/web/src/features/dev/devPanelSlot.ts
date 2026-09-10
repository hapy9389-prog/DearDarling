import { createContext, useContext } from 'react';

/**
 * 전역 DevPanel(세션 도구)과 `/app` 안에서만 쓸 수 있는 검토 레버(시나리오·리포트·추억)를
 * 한 오버레이에 함께 보여주기 위한 슬롯(0010). Provider가 열림 상태와 슬롯 DOM을 들고 있고,
 * `DevPanel`이 트리거·오버레이·슬롯을 그리고, `AppDevTools`가 `/app` Provider 안에서 그 슬롯으로
 * 포털 렌더한다. 세 컴포넌트 모두 `DevPanelProvider` 아래에 있어야 한다.
 */
export interface DevPanelSlot {
  open: boolean;
  setOpen: (open: boolean) => void;
  element: HTMLElement | null;
  setSlotRef: (node: HTMLElement | null) => void;
}

export const DevPanelSlotContext = createContext<DevPanelSlot>({
  open: false,
  setOpen: () => {},
  element: null,
  setSlotRef: () => {},
});

export function useDevPanelSlot(): DevPanelSlot {
  return useContext(DevPanelSlotContext);
}
