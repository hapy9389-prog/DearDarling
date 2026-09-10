import { describe, expect, it } from 'vitest';
import { buildTrialWeeklyReport, isoWeekOf } from '../weeklyReport';
import type { ChatMessage } from '../../types';

const NOW = new Date('2026-09-10T12:00:00'); // 목요일 (그 주 월요일 = 2026-09-07)

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    coupleId: 'trial-couple-1',
    senderId: 'trial-user-a',
    body: '메시지',
    createdAt: overrides.createdAt ?? '2026-09-08T09:00:00',
    status: overrides.status ?? 'saved',
    ...overrides,
  };
}

describe('buildTrialWeeklyReport — 체험 커플 주간 통계', () => {
  it('AI 분석 결과(대표 발견)는 만들지 않는다', () => {
    const report = buildTrialWeeklyReport('trial-couple-1', [], NOW);
    expect(report.headlineObservationId).toBeNull();
    expect(report.stats.highlights).toEqual([]);
    expect(report.weekOf).toBe('2026-09-07');
  });

  it('대화가 없으면 통계가 0이다', () => {
    const report = buildTrialWeeklyReport('trial-couple-1', [], NOW);
    expect(report.stats.totalMessages).toBe(0);
    expect(report.stats.daysWithConversation).toBe(0);
    expect(report.stats.byWeekday).toHaveLength(7);
  });

  it('저장 완료(saved)된 이번 주 메시지만 센다', () => {
    const messages = [
      message({ createdAt: '2026-09-07T09:00:00', status: 'saved' }), // 월
      message({ createdAt: '2026-09-08T09:00:00', status: 'saved' }), // 화
      message({ createdAt: '2026-09-08T20:00:00', status: 'saved' }), // 화 (같은 날)
      message({ createdAt: '2026-09-09T09:00:00', status: 'sending' }), // 전송 중 → 제외
      message({ createdAt: '2026-09-09T10:00:00', status: 'failed' }), // 실패 → 제외
      message({ createdAt: '2026-09-01T09:00:00', status: 'saved' }), // 지난 주 → 제외
    ];
    const report = buildTrialWeeklyReport('trial-couple-1', messages, NOW);
    expect(report.stats.totalMessages).toBe(3);
    expect(report.stats.daysWithConversation).toBe(2);
    const byLabel = Object.fromEntries(report.stats.byWeekday.map((d) => [d.weekday, d.count]));
    expect(byLabel['월']).toBe(1);
    expect(byLabel['화']).toBe(2);
    expect(byLabel['수']).toBe(0);
  });
});

describe('isoWeekOf', () => {
  it('그 주 월요일 날짜를 돌려준다', () => {
    expect(isoWeekOf(NOW)).toBe('2026-09-07');
    expect(isoWeekOf(new Date('2026-09-07T00:00:00'))).toBe('2026-09-07');
    expect(isoWeekOf(new Date('2026-09-13T23:59:00'))).toBe('2026-09-07'); // 일요일
  });
});
