import { describe, expect, it } from 'vitest';
import { isDeltaComparable, scorerChangedAt } from './scorerTransition.js';
import type { QabWeeklyPoint } from './QabResult.js';

const week = (weekStart: string): QabWeeklyPoint => ({
  weekStart,
  total: 10,
  correct: 5,
  accuracy: 50,
  avgScore: null,
  avgMetric: null,
});

describe('scorerChangedAt', () => {
  it('버전이 둘 이상이고 전환 시각이 있을 때만 그 시각을 준다', () => {
    expect(
      scorerChangedAt({
        scorerVersions: ['azure-pa-nbr-v1', 'azure-pa-v1'],
        scorerChangedAt: '2026-09-28T01:00:00.000Z',
      }),
    ).toBe('2026-09-28T01:00:00.000Z');
  });

  it('버전이 하나뿐이면 바뀐 것이 없다 — 처음부터 새 채점기여도', () => {
    expect(
      scorerChangedAt({
        scorerVersions: ['azure-pa-nbr-v1'],
        scorerChangedAt: '2026-09-28T01:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('옛 서버가 안 주거나 전환 시각이 없으면 null이다', () => {
    expect(scorerChangedAt({})).toBeNull();
    expect(scorerChangedAt({ scorerVersions: ['azure-pa-v1'], scorerChangedAt: null })).toBeNull();
    expect(scorerChangedAt({ scorerVersions: ['a', 'b'], scorerChangedAt: null })).toBeNull();
  });
});

describe('isDeltaComparable — 채점기를 넘어 기울기를 잇지 않는다', () => {
  const points = [week('2026-09-07'), week('2026-09-14'), week('2026-09-21')];

  it('전환이 없으면 보여준다', () => {
    expect(isDeltaComparable(points, null)).toBe(true);
  });

  it('비교하는 두 주(직전 주·이번 주)가 모두 전환 뒤면 보여준다', () => {
    // 직전 주 시작(09-14)보다 이틀 넘게 앞선 전환
    expect(isDeltaComparable(points, '2026-09-10T00:00:00.000Z')).toBe(true);
  });

  it('전환이 직전 주 안이면 숨긴다 — 한 주가 두 채점기로 섞였다', () => {
    expect(isDeltaComparable(points, '2026-09-16T00:00:00.000Z')).toBe(false);
  });

  it('전환이 이번 주 안이면 숨긴다 — 직전 주는 옛 채점기다', () => {
    expect(isDeltaComparable(points, '2026-09-23T00:00:00.000Z')).toBe(false);
  });

  it('주 경계에서 하루 어긋나도 숨기는 쪽이다(시간대 여유)', () => {
    // 직전 주 시작 하루 전(UTC) — 사용자 시간대로는 그 주 월요일일 수 있다
    expect(isDeltaComparable(points, '2026-09-13T12:00:00.000Z')).toBe(false);
    // 하루 넘게 앞서면 보여준다
    expect(isDeltaComparable(points, '2026-09-12T23:00:00.000Z')).toBe(true);
  });

  it('비교할 두 주가 없으면 숨길 이유가 없다(델타 자체가 없다)', () => {
    expect(isDeltaComparable([week('2026-09-21')], '2026-09-23T00:00:00.000Z')).toBe(true);
    expect(isDeltaComparable([], '2026-09-23T00:00:00.000Z')).toBe(true);
  });
});
