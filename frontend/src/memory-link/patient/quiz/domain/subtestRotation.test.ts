// 하위검사 로테이션 — 순환이 공평한지, 하루 구성이 성립하는지.

import { describe, expect, it } from 'vitest';
import { LEVELED_SUBTESTS } from './qabSubtestLabels.js';
import {
  ITEMS_PER_SUBTEST,
  ROTATION_ORDER,
  SUBTESTS_PER_SESSION,
  dayNumber,
  itemCountFor,
  rotationForDay,
  rotationForToday,
} from './subtestRotation.js';

describe('하위검사 로테이션', () => {
  it('순환 순서가 레벨 있는 검사 전부를 정확히 한 번씩 담는다', () => {
    // 빠뜨리면 그 검사는 영영 안 나온다. 중복이면 다른 검사가 밀린다.
    expect([...ROTATION_ORDER].sort()).toEqual([...LEVELED_SUBTESTS].sort());
  });

  it('하루에 서로 다른 세 검사를 낸다', () => {
    for (let d = 0; d < 30; d += 1) {
      const day = rotationForDay(d);
      expect(day).toHaveLength(SUBTESTS_PER_SESSION);
      expect(new Set(day).size).toBe(SUBTESTS_PER_SESSION);
    }
  });

  it('7일이면 모든 검사가 정확히 3번씩 나온다 — 어느 검사도 손해 보지 않는다', () => {
    // 7과 3이 서로소라 성립한다. 순환 길이나 하루 개수를 바꾸면 여기서 깨진다.
    const count = new Map<string, number>();
    for (let d = 0; d < 7; d += 1) {
      for (const s of rotationForDay(d)) {
        count.set(s, (count.get(s) ?? 0) + 1);
      }
    }
    expect([...count.values()]).toEqual(
      ROTATION_ORDER.map(() => 3),
    );
  });

  it('7일 중 6일에는 이해 과제(낱말·문장)가 하나 이상 들어간다', () => {
    // 일곱 중 다섯이 발화 산출이라 산출만 있는 날을 완전히 없앨 수는 없다.
    // 6/7이 가능한 최선이고, 순서를 잘못 바꾸면 이 값이 떨어진다.
    const 이해있는날 = Array.from({ length: 7 }, (_, d) => d).filter((d) =>
      rotationForDay(d).some((s) => s === 'word' || s === 'sentence'),
    );
    expect(이해있는날).toHaveLength(6);
  });

  it('같은 날은 같은 구성 — 세션을 다시 시작해도 문제 종류가 안 바뀐다', () => {
    expect(rotationForDay(12345)).toEqual(rotationForDay(12345));
    expect(rotationForToday(new Date('2026-08-27T09:00:00'))).toEqual(
      rotationForToday(new Date('2026-08-27T21:30:00')),
    );
  });

  it('날이 바뀌면 구성도 바뀐다', () => {
    expect(rotationForDay(5)).not.toEqual(rotationForDay(6));
  });

  it('1970년 이전 날짜에서도 순환이 깨지지 않는다', () => {
    // 음수 나머지로 인덱스가 -1이 되면 undefined가 섞여 세션이 빈다.
    const day = rotationForDay(-3);
    expect(day).toHaveLength(SUBTESTS_PER_SESSION);
    for (const s of day) expect(ROTATION_ORDER).toContain(s);
  });

  it('dayNumber는 로컬 자정을 경계로 1 오른다', () => {
    const 밤 = new Date(2026, 7, 27, 23, 59, 59);
    const 새벽 = new Date(2026, 7, 28, 0, 0, 1);
    expect(dayNumber(새벽) - dayNumber(밤)).toBe(1);
  });

  it('로테이션에 든 검사만 문항을 받는다', () => {
    const rotation = rotationForDay(0);
    for (const s of LEVELED_SUBTESTS) {
      expect(itemCountFor(s, rotation)).toBe(
        rotation.includes(s) ? ITEMS_PER_SUBTEST : 0,
      );
    }
  });

  it('하루 QAB 문항 수는 3검사 × 3문항 = 9', () => {
    // 데일리 2문항을 더해 세션 길이 11 — 예전 구성과 같다. 길이를 늘리는 것은
    // 순응도를 사서 쓰는 일이라, 로테이션은 길이를 그대로 두는 것이 조건이었다.
    expect(SUBTESTS_PER_SESSION * ITEMS_PER_SUBTEST).toBe(9);
  });
});
