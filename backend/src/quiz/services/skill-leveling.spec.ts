import {
  COLD_START_LEVEL,
  computeLevel,
  clampLevel,
  LEVEL_WINDOW,
  MIN_TRIALS,
  type LevelingWindowItem,
  type SkillLevel,
} from './skill-leveling';

/** isCorrect 배열을 윈도우 항목으로 변환하는 헬퍼. */
function win(...correct: boolean[]): LevelingWindowItem[] {
  return correct.map((isCorrect) => ({ isCorrect }));
}

/** n개 중 k개 정답인 윈도우. */
function ratio(k: number, n: number): LevelingWindowItem[] {
  return win(...Array.from({ length: n }, (_, i) => i < k));
}

describe('computeLevel', () => {
  it('시행 수가 MIN_TRIALS 미만이면 hold (레벨 불변)', () => {
    // 4개(=MIN_TRIALS-1) 전부 정답이어도 승급하지 않는다.
    expect(computeLevel(2, ratio(4, 4))).toBe(2);
    expect(computeLevel(2, win())).toBe(2); // 빈 윈도우(첫 세션)
  });

  it('정확도 80% 이상이면 승급(+1)', () => {
    expect(computeLevel(2, ratio(8, 10))).toBe(3); // 정확히 0.80
    expect(computeLevel(3, ratio(5, 5))).toBe(4); // 100%
  });

  it('정확도 50% 미만이면 강등(-1)', () => {
    expect(computeLevel(3, ratio(2, 5))).toBe(2); // 0.40
    expect(computeLevel(4, ratio(0, 6))).toBe(3); // 0%
  });

  it('50~79% 데드밴드는 hold', () => {
    expect(computeLevel(3, ratio(5, 10))).toBe(3); // 정확히 0.50 (강등 아님)
    expect(computeLevel(3, ratio(7, 10))).toBe(3); // 0.70
    expect(computeLevel(2, ratio(3, 5))).toBe(2); // 0.60
  });

  it('레벨 1 하한 클램프 — 최저에서 <50%여도 0으로 안 감', () => {
    expect(computeLevel(1, ratio(0, 8))).toBe(1);
  });

  it('레벨 5 상한 클램프 — 최고에서 ≥80%여도 6으로 안 감', () => {
    expect(computeLevel(5, ratio(10, 10))).toBe(5);
  });

  it('경계값: MIN_TRIALS 정확히 도달 시 판정 시작', () => {
    expect(computeLevel(2, ratio(MIN_TRIALS, MIN_TRIALS))).toBe(3); // 5/5 → 승급
    expect(computeLevel(2, ratio(0, MIN_TRIALS))).toBe(1); // 0/5 → 강등
  });

  it('멱등: 같은 입력은 같은 레벨 (재계산이 결정론적)', () => {
    const w = ratio(9, 10);
    expect(computeLevel(3, w)).toBe(computeLevel(3, w));
    expect(computeLevel(3, w)).toBe(4);
  });

  it('윈도우 상수는 10, 최소 시행은 5', () => {
    expect(LEVEL_WINDOW).toBe(10);
    expect(MIN_TRIALS).toBe(5);
    expect(COLD_START_LEVEL).toBe(2);
  });
});

describe('clampLevel', () => {
  it('범위를 [1..5]로 제한', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(6)).toBe(5);
    expect(clampLevel(3)).toBe(3);
  });

  it('경계 유지', () => {
    expect(clampLevel(1)).toBe(1 as SkillLevel);
    expect(clampLevel(5)).toBe(5 as SkillLevel);
  });
});
