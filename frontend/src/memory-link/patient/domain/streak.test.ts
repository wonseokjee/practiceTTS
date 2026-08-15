import { describe, expect, it } from 'vitest';
import { buildWeekStreak, toLocalYmd, type DayStatus } from './streak.js';

/** 2026-08-12는 수요일. 그 주 월요일 = 2026-08-10. */
const WED = new Date(2026, 7, 12); // month 0-indexed: 7=8월

function statuses(days: { status: DayStatus }[]): DayStatus[] {
  return days.map((d) => d.status);
}

describe('buildWeekStreak', () => {
  it('7일(월~일)을 반환하고 라벨이 요일이다', () => {
    const days = buildWeekStreak(new Set(), WED);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.label)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
  });

  it('완료한 지난 날=done, 안 한 지난 날=missed(중립), 미래=future', () => {
    // 월(완료), 화(안함)는 과거. 수=오늘. 목~일=미래.
    const completed = new Set([toLocalYmd(new Date(2026, 7, 10))]); // 월요일
    const days = buildWeekStreak(completed, WED);
    expect(statuses(days)).toEqual([
      'done', // 월 완료
      'missed', // 화 놓침(중립)
      'today', // 수 오늘(아직)
      'future', // 목
      'future', // 금
      'future', // 토
      'future', // 일
    ]);
  });

  it('오늘 완료하면 today-done', () => {
    const completed = new Set([toLocalYmd(WED)]);
    const days = buildWeekStreak(completed, WED);
    expect(days[2].status).toBe('today-done');
  });

  it('놓친 날 aria는 "실패"가 아니라 "쉼"(중립)', () => {
    const days = buildWeekStreak(new Set(), WED);
    // 화요일(과거·미완료)
    expect(days[1].ariaLabel).toBe('화요일 쉼');
    expect(days[1].ariaLabel).not.toContain('실패');
    // 완료한 날
    const done = buildWeekStreak(new Set([toLocalYmd(new Date(2026, 7, 10))]), WED);
    expect(done[0].ariaLabel).toBe('월요일 완료');
  });

  it('오늘 aria는 "오늘"/"오늘 완료"', () => {
    expect(buildWeekStreak(new Set(), WED)[2].ariaLabel).toBe('오늘');
    expect(buildWeekStreak(new Set([toLocalYmd(WED)]), WED)[2].ariaLabel).toBe('오늘 완료');
  });

  it('일요일 기준: (일=주의 끝) 월~토가 과거, 일이 오늘', () => {
    const SUN = new Date(2026, 7, 16); // 2026-08-16 일요일
    const days = buildWeekStreak(new Set(), SUN);
    expect(days[6].status).toBe('today');
    expect(days.slice(0, 6).every((d) => d.status === 'missed')).toBe(true);
  });

  it('월요일 기준: 월=오늘, 나머지 전부 미래', () => {
    const MON = new Date(2026, 7, 10);
    const days = buildWeekStreak(new Set(), MON);
    expect(days[0].status).toBe('today');
    expect(days.slice(1).every((d) => d.status === 'future')).toBe(true);
  });
});

describe('toLocalYmd', () => {
  it('로컬 날짜를 YYYY-MM-DD로(UTC 변환 밀림 없음)', () => {
    expect(toLocalYmd(new Date(2026, 7, 3))).toBe('2026-08-03');
    expect(toLocalYmd(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});
