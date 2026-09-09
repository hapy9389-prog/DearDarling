import { useNavigation } from '../state/NavigationContext';
import { MockModeBanner } from './MockModeBanner';
import { BottomNav } from './BottomNav';
import { ChatPage } from '../features/chat/ChatPage';
import { HomePage } from '../features/home/HomePage';
import { WeekPage } from '../features/week/WeekPage';
import { MemoriesPage } from '../features/memories/MemoriesPage';
import { SettingsPage } from '../features/settings/SettingsPage';

export function AppShell() {
  const { screen } = useNavigation();
  const chatHidden = screen !== 'chat';

  return (
    <div className="flex h-full flex-col">
      <MockModeBanner />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/*
          대화 화면은 항상 마운트해 두고 비활성일 때 hidden + inert로 감춘다(0003).
          전송·재시도가 진행 중일 때 다른 탭에 갔다 와도 완료 결과가 살아있는 상태에 반영되고,
          inert로 숨긴 화면의 포커스·스크롤이 현재 탭에 영향을 주지 않는다.
        */}
        <div
          hidden={chatHidden}
          inert={chatHidden}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <ChatPage />
        </div>
        {screen === 'home' && <HomePage />}
        {screen === 'week' && <WeekPage />}
        {screen === 'memories' && <MemoriesPage />}
        {screen === 'settings' && <SettingsPage />}
      </div>
      <BottomNav />
    </div>
  );
}
