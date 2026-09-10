import type { DraftHelpExample } from '../../mocks/fixtures/draftHelp';

/**
 * 입력창 바로 위 얇은 한 줄. 대화 목록을 덮지 않고 밀어낸다. 실제 AI가 아니라 화면 검토용 예시다.
 * 적용 전에도 **어떤 문장으로 바뀌는지**(대체 표현)를 그대로 보여준다.
 * '이렇게 바꾸기'를 눌러야만 초안의 해당 구간이 바뀐다 — 자동 수정·자동 전송은 없다.
 */
export function DraftHelpHint({
  example,
  onApply,
}: {
  example: DraftHelpExample;
  onApply: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-t border-border bg-canvas-raised px-3 pt-2 text-xs leading-relaxed text-ink-soft">
      <span aria-hidden="true">💡</span>
      <div className="flex-1">
        <p>
          {example.note}{' '}
          <span className="eyebrow ml-1 rounded-full bg-pending-soft px-1.5 py-0.5 text-pending">
            화면 검토용 예시
          </span>
        </p>
        <p className="mt-1 rounded-lg border border-coaching-border bg-coaching-soft px-2 py-1 text-ink">
          이렇게: “{example.alternative}”
        </p>
        <button
          type="button"
          onClick={onApply}
          className="mt-1.5 rounded-full border border-coaching-border bg-coaching-soft px-3 py-1 font-medium text-coaching"
        >
          이렇게 바꾸기
        </button>
      </div>
    </div>
  );
}
