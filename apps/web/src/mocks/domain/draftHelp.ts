import { SEED_DRAFT_HELP_EXAMPLES, type DraftHelpExample } from '../fixtures/draftHelp';

/**
 * 작성 중 표현 도움의 순수 규칙(화면 검토용). 실제 packages/domain으로 옮겨질 때까지 여기서 관리한다.
 * - 지정 예시 문구(공백 포함 구)로만 매칭한다 — '왜' 같은 단어 하나로는 경고하지 않는다.
 * - 초안 파생값이라 상태로 남기지 않는다: 입력이 바뀌면 다시 계산해 맞지 않는 오래된 제안은 사라진다.
 */
export interface DraftHelpMatch {
  example: DraftHelpExample;
  start: number;
  end: number;
}

/**
 * 초안에서 예시 문구가 처음 나타나는 위치 **한 곳만** 돌려준다(같은 문구가 여러 번 있어도 첫 곳).
 * 여러 예시가 걸리면 초안에서 더 앞선 것을 고른다.
 */
export function matchDraftHelp(
  draft: string,
  examples: DraftHelpExample[] = SEED_DRAFT_HELP_EXAMPLES,
): DraftHelpMatch | null {
  let best: DraftHelpMatch | null = null;
  for (const example of examples) {
    const start = draft.indexOf(example.trigger);
    if (start === -1) continue;
    if (!best || start < best.start) {
      best = { example, start, end: start + example.trigger.length };
    }
  }
  return best;
}

/**
 * 매칭된 구간만 대체 표현으로 바꾼다. 나머지 입력은 그대로 둔다.
 * 이음매 정리: 대체 표현이 문장부호로 끝나는데 **같은 줄에서** 바로 뒤에 부호가 이어지면 하나로
 * 합친다("무슨 일이 있었어?" + "?" → "무슨 일이 있었어?"). 줄바꿈은 넘지 않는다 — 다음 줄과
 * 그 줄의 문장부호("...")는 그대로 둔다.
 */
export function applyDraftHelp(draft: string, match: DraftHelpMatch): string {
  const before = draft.slice(0, match.start);
  const replacement = match.example.alternative;
  let after = draft.slice(match.end);

  if (/[?!.]$/.test(replacement)) {
    // \s가 아니라 [ \t]만 — 개행을 만나면 멈춰서 다음 줄을 건드리지 않는다.
    after = after.replace(/^[ \t]*[?!.]+/, '');
  }

  return before + replacement + after;
}
