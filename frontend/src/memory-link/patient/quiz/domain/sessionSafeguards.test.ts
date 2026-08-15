import { describe, expect, it } from 'vitest';
import {
  FATIGUE_EXIT_THRESHOLD,
  moveEasiestLast,
  shouldFatigueExit,
} from './sessionSafeguards.js';

describe('shouldFatigueExit', () => {
  it('연속 오답이 임계치 미만이면 false, 도달하면 true', () => {
    expect(shouldFatigueExit(0)).toBe(false);
    expect(shouldFatigueExit(2)).toBe(false);
    expect(shouldFatigueExit(FATIGUE_EXIT_THRESHOLD)).toBe(true);
    expect(shouldFatigueExit(5)).toBe(true);
  });

  it('임계치는 주입 가능', () => {
    expect(shouldFatigueExit(2, 2)).toBe(true);
    expect(shouldFatigueExit(1, 2)).toBe(false);
  });
});

describe('moveEasiestLast', () => {
  it('성공확률 최대 항목을 맨 뒤로 보내고 나머지 순서는 보존', () => {
    const items = [
      { id: 'a', rank: 1 },
      { id: 'b', rank: 3 }, // 최대
      { id: 'c', rank: 2 },
    ];
    const out = moveEasiestLast(items, (x) => x.rank);
    expect(out.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('동점이면 앞쪽을 마지막으로(안정)', () => {
    const items = [
      { id: 'a', rank: 5 },
      { id: 'b', rank: 5 },
      { id: 'c', rank: 1 },
    ];
    const out = moveEasiestLast(items, (x) => x.rank);
    // a가 최초 최대 → 맨 뒤, b·c 순서 보존
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('0~1개는 그대로 반환', () => {
    expect(moveEasiestLast([], () => 0)).toEqual([]);
    expect(moveEasiestLast([{ id: 'x', rank: 1 }], (x) => x.rank)).toEqual([
      { id: 'x', rank: 1 },
    ]);
  });

  it('원본을 변경하지 않는다(새 배열 반환)', () => {
    const items = [
      { id: 'a', rank: 1 },
      { id: 'b', rank: 2 },
    ];
    const out = moveEasiestLast(items, (x) => x.rank);
    expect(items.map((x) => x.id)).toEqual(['a', 'b']); // 원본 보존
    expect(out).not.toBe(items);
  });
});
