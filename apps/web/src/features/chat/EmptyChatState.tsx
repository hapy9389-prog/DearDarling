import { StateCard } from '../../shared/components/StateCard';

export function EmptyChatState({ partnerNickname }: { partnerNickname: string }) {
  return (
    <StateCard
      icon="✉️"
      title="아직 나눈 대화가 없어요"
      description={`${partnerNickname}님에게 먼저 인사를 건네 보세요.`}
    />
  );
}
