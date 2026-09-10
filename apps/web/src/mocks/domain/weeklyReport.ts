import type { ChatMessage, WeeklyReport, WeeklyReportStats } from '../types';

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'] as const;
const DAY_MS = 86_400_000;

/** 월요일 0시(로컬)를 그 주의 시작으로 본다. */
function mondayOf(now: Date): Date {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayIndex = (midnight.getDay() + 6) % 7; // 월=0 … 일=6
  midnight.setDate(midnight.getDate() - mondayIndex);
  return midnight;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 오늘 저장 완료된(status === 'saved') 메시지가 하나라도 있는가. 주간 통계 기간과 별개로 본다. */
export function hadSavedMessageToday(
  messages: { status: string; createdAt: string }[],
  now: Date = new Date(),
): boolean {
  return messages.some((message) => {
    if (message.status !== 'saved') return false;
    const at = new Date(message.createdAt);
    return !Number.isNaN(at.getTime()) && isSameLocalDay(at, now);
  });
}

/** 그 주 월요일 날짜('YYYY-MM-DD'). */
export function isoWeekOf(now: Date = new Date()): string {
  const monday = mondayOf(now);
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 신규 체험 커플의 주간 리포트(0010). 실제 AI 분석이 없으므로 관찰·대표 발견은 만들지 않고
 * (`headlineObservationId: null`, `highlights: []`), 통계는 **이번 주(월~일) 범위의 저장 완료된
 * (`status === 'saved'`) 메시지만**으로 계산한다. 전송 중·실패 메시지는 세지 않는다.
 */
export function buildTrialWeeklyReport(
  coupleId: string,
  messages: ChatMessage[],
  now: Date = new Date(),
): WeeklyReport {
  const monday = mondayOf(now);
  const start = monday.getTime();
  const end = start + 7 * DAY_MS;

  const counts = [0, 0, 0, 0, 0, 0, 0];
  const daysWithMessages = new Set<string>();

  for (const message of messages) {
    if (message.status !== 'saved') continue;
    const at = new Date(message.createdAt);
    const time = at.getTime();
    if (Number.isNaN(time) || time < start || time >= end) continue;
    const weekdayIndex = (at.getDay() + 6) % 7;
    counts[weekdayIndex] = (counts[weekdayIndex] ?? 0) + 1;
    daysWithMessages.add(`${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`);
  }

  const stats: WeeklyReportStats = {
    totalMessages: counts.reduce((sum, count) => sum + count, 0),
    daysWithConversation: daysWithMessages.size,
    activeDaysTotal: 7,
    byWeekday: WEEKDAY_LABELS.map((weekday, index) => ({ weekday, count: counts[index] ?? 0 })),
    highlights: [],
  };

  return {
    coupleId,
    weekOf: isoWeekOf(now),
    deliveredAt: monday.toISOString(),
    headlineObservationId: null,
    stats,
  };
}
