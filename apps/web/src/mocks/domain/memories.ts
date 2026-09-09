import type { ExampleImageRef, Memory, MemorySuggestion, RememberWhen } from '../types';

/**
 * 추억 목록·AI 발견 제안·'그때의 우리' 리마인드의 순수 규칙(docs/decisions/0008).
 * 실제 packages/domain으로 옮겨질 때까지 여기서 관리한다.
 *
 * 날짜 계산은 모두 **같은 시간대(로컬) 자정 기준**을 쓴다 — 저장일 구분선과 리마인드 마일스톤이
 * 서로 다른 기준으로 어긋나지 않도록. '1년 전'은 365일 곱셈이 아니라 달력 날짜(같은 월·일)로 센다.
 */

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** a가 b보다 며칠 뒤인지(로컬 자정 기준, 음수 가능). */
function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfLocalDay(a) - startOfLocalDay(b)) / 86_400_000);
}

export function sortBySavedNewest(memories: Memory[]): Memory[] {
  return [...memories].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function canEditMemory(memory: Memory, userId: string): boolean {
  return memory.savedByUserId === userId;
}

export function memoryCardLayout(
  memory: Pick<Memory, 'layout' | 'images'>,
): 'photo' | 'conversation' {
  if (memory.layout) return memory.layout;
  return memory.images && memory.images.length > 0 ? 'photo' : 'conversation';
}

export function memoryImages(memory: Pick<Memory, 'images'>): ExampleImageRef[] {
  return memory.images ?? [];
}

/** "오늘 저장" / "어제 저장" / "N일 전 저장"(7일 미만) / "YYYY년 M월 D일 저장". */
export function savedDateLabel(savedAt: string, now: Date = new Date()): string {
  const diff = dayDiff(now, new Date(savedAt));
  if (diff <= 0) return '오늘 저장';
  if (diff === 1) return '어제 저장';
  if (diff < 7) return `${diff}일 전 저장`;
  const d = new Date(savedAt);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 저장`;
}

/** "YYYY년 M월 D일" — 카드·상세의 '대화 날짜'. */
export function conversationDateLabel(conversationAt: string): string {
  const d = new Date(conversationAt);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export interface SavedDateGroup {
  label: string;
  memories: Memory[];
}

/** 이미 정렬된(최신 저장순) 목록을 저장일 라벨로 묶는다. */
export function groupBySavedDate(memories: Memory[], now: Date = new Date()): SavedDateGroup[] {
  const groups: SavedDateGroup[] = [];
  for (const memory of memories) {
    const label = savedDateLabel(memory.savedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.memories.push(memory);
    else groups.push({ label, memories: [memory] });
  }
  return groups;
}

/** 시드 제안에서 이미 저장된 메시지의 제안과 이 사용자가 숨긴 제안을 뺀 목록. */
export function visibleSuggestions(
  seed: MemorySuggestion[],
  savedMemories: Memory[],
  hiddenIds: string[],
): MemorySuggestion[] {
  const savedMessageIds = new Set(savedMemories.map((memory) => memory.sourceMessageId));
  const hidden = new Set(hiddenIds);
  return seed.filter(
    (suggestion) => !savedMessageIds.has(suggestion.sourceMessageId) && !hidden.has(suggestion.id),
  );
}

// '그때의 우리' 마일스톤. 일 단위와 달력 연 단위를 나눠서 본다.
export const REMEMBER_DAY_MILESTONES = [100, 200, 300, 500] as const;
export const REMEMBER_YEAR_MILESTONES = [1, 2, 3, 4, 5] as const;
const APPROX_TOLERANCE_DAYS = 3;

interface MilestoneMatch {
  match: 'exact' | 'approx';
  error: number;
  key: string;
  phrase: string;
}

function bestMilestoneForMemory(conversationAt: string, now: Date): MilestoneMatch | null {
  const conversation = new Date(conversationAt);
  const candidates: MilestoneMatch[] = [];

  const elapsed = dayDiff(now, conversation);
  for (const days of REMEMBER_DAY_MILESTONES) {
    const error = Math.abs(elapsed - days);
    if (error > APPROX_TOLERANCE_DAYS) continue;
    candidates.push({
      match: error === 0 ? 'exact' : 'approx',
      error,
      key: `d${days}`,
      phrase: error === 0 ? `${days}일 전 오늘` : `약 ${days}일 전`,
    });
  }

  for (const years of REMEMBER_YEAR_MILESTONES) {
    const anniversary = new Date(
      conversation.getFullYear() + years,
      conversation.getMonth(),
      conversation.getDate(),
    );
    const error = Math.abs(dayDiff(now, anniversary));
    if (error > APPROX_TOLERANCE_DAYS) continue;
    candidates.push({
      match: error === 0 ? 'exact' : 'approx',
      error,
      key: `y${years}`,
      phrase: error === 0 ? `${years}년 전 오늘` : `약 ${years}년 전`,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.match !== b.match) return a.match === 'exact' ? -1 : 1;
    return a.error - b.error;
  });
  return candidates[0] ?? null;
}

/**
 * 앨범에 저장된 추억 중 오늘이 마일스톤(±3일)에 걸리는 것 1건을 고른다.
 * `dismissedKeys`(memoryId#milestone)에 든 조합은 건너뛴다 — 같은 추억이라도 다른 마일스톤은 살아있다.
 * 후보가 없으면 null → 리마인드를 그리지 않는다.
 */
export function pickRememberWhen(
  memories: Memory[],
  dismissedKeys: string[],
  now: Date = new Date(),
): RememberWhen | null {
  const dismissed = new Set(dismissedKeys);
  const matches = memories
    .map((memory) => {
      const milestone = bestMilestoneForMemory(memory.conversationAt, now);
      if (!milestone) return null;
      const dismissKey = `${memory.id}#${milestone.key}`;
      if (dismissed.has(dismissKey)) return null;
      return { memory, milestone, dismissKey };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.milestone.match !== b.milestone.match) return a.milestone.match === 'exact' ? -1 : 1;
    if (a.milestone.error !== b.milestone.error) return a.milestone.error - b.milestone.error;
    return a.memory.conversationAt.localeCompare(b.memory.conversationAt);
  });

  const top = matches[0];
  if (!top) return null;
  return {
    memory: top.memory,
    match: top.milestone.match,
    phrase: top.milestone.phrase,
    dismissKey: top.dismissKey,
  };
}
