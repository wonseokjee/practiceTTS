import { describe, it, expect } from 'vitest';
import { calculateLocScore, calculateFinalLocScore } from './LocScorer.js';

describe('calculateLocScore - 경계값 테스트', () => {
  // --- null / out-of-bounds ---
  it('latency가 null이면 0점을 반환한다', () => {
    expect(calculateLocScore(null, true)).toBe(0);
  });

  it('touchInBounds가 false이면 0점을 반환한다 (latency가 있어도)', () => {
    expect(calculateLocScore(1000, false)).toBe(0);
  });

  it('latency가 null이고 touchInBounds도 false이면 0점을 반환한다', () => {
    expect(calculateLocScore(null, false)).toBe(0);
  });

  // --- 3점 경계 (≤ 3,000ms) ---
  it('latency = 1ms 이면 3점을 반환한다', () => {
    expect(calculateLocScore(1, true)).toBe(3);
  });

  it('latency = 3000ms 이면 3점을 반환한다 (경계값 포함)', () => {
    expect(calculateLocScore(3_000, true)).toBe(3);
  });

  it('latency = 3001ms 이면 2점을 반환한다 (경계 초과)', () => {
    expect(calculateLocScore(3_001, true)).toBe(2);
  });

  // --- 2점 경계 (≤ 6,000ms) ---
  it('latency = 6000ms 이면 2점을 반환한다 (경계값 포함)', () => {
    expect(calculateLocScore(6_000, true)).toBe(2);
  });

  it('latency = 6001ms 이면 1점을 반환한다 (경계 초과)', () => {
    expect(calculateLocScore(6_001, true)).toBe(1);
  });

  // --- 1점 경계 (≤ 10,000ms) ---
  it('latency = 10000ms 이면 1점을 반환한다 (경계값 포함)', () => {
    expect(calculateLocScore(10_000, true)).toBe(1);
  });

  it('latency = 10001ms 이면 0점을 반환한다 (시간 초과)', () => {
    expect(calculateLocScore(10_001, true)).toBe(0);
  });

  it('latency = 99999ms 이면 0점을 반환한다', () => {
    expect(calculateLocScore(99_999, true)).toBe(0);
  });
});

describe('calculateFinalLocScore - 최고 점수 채택', () => {
  it('빈 배열이면 0을 반환한다', () => {
    expect(calculateFinalLocScore([])).toBe(0);
  });

  it('단일 시도의 점수를 그대로 반환한다', () => {
    expect(calculateFinalLocScore([{ score: 2 }])).toBe(2);
  });

  it('여러 시도 중 최고 점수를 반환한다', () => {
    expect(calculateFinalLocScore([{ score: 1 }, { score: 3 }, { score: 2 }])).toBe(3);
  });

  it('모든 시도가 0점이면 0을 반환한다', () => {
    expect(calculateFinalLocScore([{ score: 0 }, { score: 0 }, { score: 0 }])).toBe(0);
  });

  it('시도 순서에 관계없이 최고 점수를 반환한다', () => {
    expect(calculateFinalLocScore([{ score: 3 }, { score: 0 }, { score: 1 }])).toBe(3);
  });
});
