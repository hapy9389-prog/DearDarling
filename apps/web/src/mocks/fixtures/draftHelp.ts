/**
 * 작성 중 표현 도움 — 화면 검토용 지정 예시(실제 AI 분석이 아니다).
 * 상대 대화를 보지 않고, 사용자가 입력창에 친 텍스트를 이 고정 목록과 대조할 뿐이다.
 * 개인 설정(`UserSettings.draftHelpEnabled`)이 켜져 있을 때만 동작하며, 양측 분석 동의와는 무관하다.
 */
export interface DraftHelpExample {
  id: string;
  /** 초안에 이 문구(공백 포함 구)가 그대로 보이면 도움말을 띄운다. 단어 하나로는 매칭하지 않는다. */
  trigger: string;
  /** 왜 바꿔볼 만한지 짧은 이유 한 줄(대체 문장은 별도로 항상 함께 보여준다). */
  note: string;
  /** '이렇게 바꾸기'를 누르면 trigger 구간을 이 문장으로 교체한다. 적용 전에도 화면에 그대로 보여준다. */
  alternative: string;
}

export const SEED_DRAFT_HELP_EXAMPLES: DraftHelpExample[] = [
  {
    id: 'why-did-you',
    trigger: '왜 그렇게 했어',
    note: '추궁처럼 들릴 수 있어요. 열린 질문으로 바꿔볼까요?',
    alternative: '무슨 일이 있었어?',
  },
  {
    id: 'never-mind',
    trigger: '됐어 그냥',
    note: '지금 상태를 먼저 알려주면 오해가 줄어요.',
    alternative: '지금은 좀 힘들어서 이따 얘기해도 될까?',
  },
  {
    id: 'always-like-this',
    trigger: '맨날 그런 식이야',
    note: '이번 일에 대한 내 느낌으로 말해볼 수도 있어요.',
    alternative: '이번 일은 나한테 이렇게 느껴졌어',
  },
  {
    id: 'do-what-you-want',
    trigger: '알아서 해',
    note: '내 생각을 먼저 전하고 상대 의견도 물어볼 수 있어요.',
    alternative: '나는 이게 더 좋은데, 너는 어때?',
  },
];
