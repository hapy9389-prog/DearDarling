import { describe, expect, it } from 'vitest';
import type { Memory, MemorySuggestion } from '../../types';
import {
  canEditMemory,
  conversationDateLabel,
  groupBySavedDate,
  memoryCardLayout,
  pickRememberWhen,
  savedDateLabel,
  sortBySavedNewest,
  visibleSuggestions,
} from '../memories';

const NOW = new Date('2026-09-09T10:00:00');

function isoDaysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? 'm1',
    coupleId: 'couple-1',
    savedByUserId: 'user-minjun',
    savedAt: overrides.savedAt ?? isoDaysBefore(0),
    sourceMessageId: overrides.sourceMessageId ?? 'msg-1',
    quoteBody: '인용',
    quoteSenderId: 'user-seoyeon',
    conversationAt: overrides.conversationAt ?? isoDaysBefore(0),
    ...overrides,
  };
}

describe('memories 도메인 — 목록/카드', () => {
  it('sortBySavedNewest: 최신 저장순', () => {
    const older = memory({ id: 'a', savedAt: isoDaysBefore(5) });
    const newer = memory({ id: 'b', savedAt: isoDaysBefore(1) });
    expect(sortBySavedNewest([older, newer]).map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('canEditMemory: 저장한 사람만 true', () => {
    const m = memory({ savedByUserId: 'user-minjun' });
    expect(canEditMemory(m, 'user-minjun')).toBe(true);
    expect(canEditMemory(m, 'user-seoyeon')).toBe(false);
  });

  it('memoryCardLayout: layout 명시가 우선, 없으면 images 유무로 파생', () => {
    expect(
      memoryCardLayout({ layout: 'conversation', images: [{ variant: 'sea', alt: 'x' }] }),
    ).toBe('conversation');
    expect(memoryCardLayout({ images: [{ variant: 'sea', alt: 'x' }] })).toBe('photo');
    expect(memoryCardLayout({})).toBe('conversation');
  });

  it('savedDateLabel: 오늘/어제/N일 전/날짜', () => {
    expect(savedDateLabel(isoDaysBefore(0), NOW)).toBe('오늘 저장');
    expect(savedDateLabel(isoDaysBefore(1), NOW)).toBe('어제 저장');
    expect(savedDateLabel(isoDaysBefore(3), NOW)).toBe('3일 전 저장');
    expect(savedDateLabel(new Date('2026-01-05T09:00:00').toISOString(), NOW)).toBe(
      '2026년 1월 5일 저장',
    );
  });

  it('conversationDateLabel: YYYY년 M월 D일', () => {
    expect(conversationDateLabel(new Date('2026-06-01T09:00:00').toISOString())).toBe(
      '2026년 6월 1일',
    );
  });

  it('groupBySavedDate: 같은 라벨끼리 묶는다', () => {
    const groups = groupBySavedDate(
      [
        memory({ id: 'a', savedAt: isoDaysBefore(0) }),
        memory({ id: 'b', savedAt: isoDaysBefore(0) }),
        memory({ id: 'c', savedAt: isoDaysBefore(3) }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['오늘 저장', '3일 전 저장']);
    expect(groups[0]?.memories.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('memories 도메인 — AI 발견 제안 필터', () => {
  const seed: MemorySuggestion[] = [
    {
      id: 's1',
      coupleId: 'couple-1',
      sourceMessageId: 'msg-1',
      quoteBody: '',
      quoteSenderId: 'u',
      conversationAt: isoDaysBefore(1),
      reason: '',
    },
    {
      id: 's2',
      coupleId: 'couple-1',
      sourceMessageId: 'msg-2',
      quoteBody: '',
      quoteSenderId: 'u',
      conversationAt: isoDaysBefore(1),
      reason: '',
    },
    {
      id: 's3',
      coupleId: 'couple-1',
      sourceMessageId: 'msg-3',
      quoteBody: '',
      quoteSenderId: 'u',
      conversationAt: isoDaysBefore(1),
      reason: '',
    },
  ];

  it('이미 저장된 메시지의 제안과 숨긴 제안을 뺀다', () => {
    const saved = [memory({ sourceMessageId: 'msg-1' })];
    const visible = visibleSuggestions(seed, saved, ['s2']);
    expect(visible.map((s) => s.id)).toEqual(['s3']);
  });
});

describe('memories 도메인 — 그때의 우리', () => {
  it('정확히 100일 전이면 exact "100일 전 오늘"', () => {
    const result = pickRememberWhen([memory({ conversationAt: isoDaysBefore(100) })], [], NOW);
    expect(result?.match).toBe('exact');
    expect(result?.phrase).toBe('100일 전 오늘');
  });

  it('마일스톤 근사(±3일)면 approx "약 100일 전"', () => {
    const result = pickRememberWhen([memory({ conversationAt: isoDaysBefore(102) })], [], NOW);
    expect(result?.match).toBe('approx');
    expect(result?.phrase).toBe('약 100일 전');
  });

  it('마일스톤에서 벗어나면 null', () => {
    expect(pickRememberWhen([memory({ conversationAt: isoDaysBefore(120) })], [], NOW)).toBeNull();
  });

  it('1년은 365일 곱셈이 아니라 달력 날짜로 센다', () => {
    const exact = pickRememberWhen(
      [memory({ id: 'y', conversationAt: new Date('2025-09-09T10:00:00').toISOString() })],
      [],
      NOW,
    );
    expect(exact?.match).toBe('exact');
    expect(exact?.phrase).toBe('1년 전 오늘');

    const approx = pickRememberWhen(
      [memory({ id: 'y', conversationAt: new Date('2025-09-11T10:00:00').toISOString() })],
      [],
      NOW,
    );
    expect(approx?.phrase).toBe('약 1년 전');
  });

  it('이 리마인드만 닫기 — 같은 추억의 다른 마일스톤은 계속 뜬다', () => {
    // 오늘이 이 추억의 100일이자 (동시에) 다른 추억의 1년이 되도록 두 개를 둔다.
    const hundred = memory({ id: 'h', conversationAt: isoDaysBefore(100) });
    const firstDismiss = pickRememberWhen([hundred], [], NOW);
    expect(firstDismiss?.dismissKey).toBe('h#d100');

    // d100을 닫아도 200일 마일스톤(다른 추억)은 살아있다.
    const twoHundred = memory({ id: 't', conversationAt: isoDaysBefore(200) });
    const afterDismiss = pickRememberWhen([hundred, twoHundred], ['h#d100'], NOW);
    expect(afterDismiss?.memory.id).toBe('t');
    expect(afterDismiss?.dismissKey).toBe('t#d200');
  });

  it('exact를 approx보다 우선 선택한다', () => {
    const result = pickRememberWhen(
      [
        memory({ id: 'approx', conversationAt: isoDaysBefore(103) }),
        memory({ id: 'exact', conversationAt: isoDaysBefore(200) }),
      ],
      [],
      NOW,
    );
    expect(result?.memory.id).toBe('exact');
  });
});
