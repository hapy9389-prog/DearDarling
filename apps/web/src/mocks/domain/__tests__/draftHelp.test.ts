import { describe, expect, it } from 'vitest';
import { applyDraftHelp, matchDraftHelp } from '../draftHelp';
import type { DraftHelpExample } from '../../fixtures/draftHelp';

const EXAMPLES: DraftHelpExample[] = [
  { id: 'why', trigger: '왜 그렇게 했어', note: '...', alternative: '무슨 일이 있었어?' },
  { id: 'nvm', trigger: '됐어 그냥', note: '...', alternative: '이따 얘기해도 될까?' },
];

describe('matchDraftHelp', () => {
  it('지정 문구가 초안에 있으면 그 구간을 돌려준다', () => {
    const match = matchDraftHelp('너 왜 그렇게 했어? 진짜', EXAMPLES);
    expect(match?.example.id).toBe('why');
    expect('너 왜 그렇게 했어? 진짜'.slice(match!.start, match!.end)).toBe('왜 그렇게 했어');
  });

  it("단어 하나('왜')만으로는 매칭하지 않는다", () => {
    expect(matchDraftHelp('왜?', EXAMPLES)).toBeNull();
    expect(matchDraftHelp('왜 안 왔어', EXAMPLES)).toBeNull();
  });

  it('매칭이 없으면 null', () => {
    expect(matchDraftHelp('오늘 뭐 먹을까?', EXAMPLES)).toBeNull();
  });

  it('같은 문구가 여러 번 있어도 첫 구간만 돌려준다', () => {
    const draft = '왜 그렇게 했어 왜 그렇게 했어';
    const match = matchDraftHelp(draft, EXAMPLES);
    expect(match?.start).toBe(0);
    expect(match?.end).toBe('왜 그렇게 했어'.length);
  });

  it('여러 예시가 걸리면 초안에서 더 앞선 것을 고른다', () => {
    const match = matchDraftHelp('됐어 그냥, 왜 그렇게 했어', EXAMPLES);
    expect(match?.example.id).toBe('nvm');
  });
});

describe('applyDraftHelp', () => {
  it('매칭된 첫 구간만 대체하고 나머지 입력은 보존한다', () => {
    const draft = '너 왜 그렇게 했어 진짜 궁금해';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe('너 무슨 일이 있었어? 진짜 궁금해');
  });

  it('같은 문구가 두 번이면 첫 번째만 바꾸고 두 번째는 그대로 둔다', () => {
    const draft = '왜 그렇게 했어 왜 그렇게 했어';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe('무슨 일이 있었어? 왜 그렇게 했어');
  });

  it('이음매에서 물음표가 중복되지 않는다', () => {
    const draft = '왜 그렇게 했어?';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe('무슨 일이 있었어?');
  });

  it('이음매의 "?." 같은 부호 겹침도 정리한다', () => {
    const draft = '왜 그렇게 했어?.';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe('무슨 일이 있었어?');
  });

  it('부호 없이 이어지는 뒤 텍스트는 그대로 붙인다', () => {
    const draft = '됐어 그냥 나 잘게';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe('이따 얘기해도 될까? 나 잘게');
  });

  it('줄바꿈을 넘어 다음 줄과 그 줄의 문장부호를 지우지 않는다', () => {
    const draft = '왜 그렇게 했어\n아직 말하기 어렵다면 나중에 얘기해';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe(
      '무슨 일이 있었어?\n아직 말하기 어렵다면 나중에 얘기해',
    );
  });

  it('다음 줄이 문장부호로 시작해도(…) 그대로 유지한다', () => {
    const draft = '왜 그렇게 했어\n...아직 말하기 어렵다면 나중에 얘기해';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe(
      '무슨 일이 있었어?\n...아직 말하기 어렵다면 나중에 얘기해',
    );
  });

  it('같은 줄에서 물음표가 이어지면 정리하되 그 뒤 텍스트는 유지한다', () => {
    const draft = '왜 그렇게 했어? 진짜 궁금해';
    const match = matchDraftHelp(draft, EXAMPLES)!;
    expect(applyDraftHelp(draft, match)).toBe('무슨 일이 있었어? 진짜 궁금해');
  });
});
