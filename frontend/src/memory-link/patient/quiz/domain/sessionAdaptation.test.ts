import { describe, expect, it } from 'vitest';
import {
  DEMOTE_AFTER_WRONG,
  MAX_LEVEL,
  MIN_LEVEL,
  PROMOTE_AFTER_CORRECT,
  adaptedLevel,
  didAdapt,
} from './sessionAdaptation.js';

const 오답 = false;
const 정답 = true;

describe('세션 내 적응', () => {
  it('기록이 없으면 시작 레벨 그대로', () => {
    expect(adaptedLevel(3, [])).toBe(3);
    expect(didAdapt(3, [])).toBe(false);
  });

  it('2연속 오답이면 한 칸 내린다', () => {
    expect(adaptedLevel(3, [오답, 오답])).toBe(2);
    expect(didAdapt(3, [오답, 오답])).toBe(true);
  });

  it('한 번 틀린 것만으로는 안 내린다 — 한 문항은 컨디션일 수 있다', () => {
    expect(adaptedLevel(3, [오답])).toBe(3);
  });

  it('사이에 정답이 끼면 연속이 끊긴다', () => {
    expect(adaptedLevel(3, [오답, 정답, 오답])).toBe(3);
  });

  it('3연속 정답이면 한 칸 올린다', () => {
    expect(adaptedLevel(3, [정답, 정답, 정답])).toBe(4);
  });

  it('2연속 정답으로는 안 올린다 — 승급이 강등보다 보수적이다', () => {
    // 잘못 올리면 환자는 못 푸는 문항을 만나고, 잘못 내리면 쉬운 문항을 만난다.
    // 두 실수의 비용이 다르므로 임계도 달라야 한다.
    expect(adaptedLevel(3, [정답, 정답])).toBe(3);
    expect(PROMOTE_AFTER_CORRECT).toBeGreaterThan(DEMOTE_AFTER_WRONG);
  });

  it('세션당 한 칸만 움직인다 — 3연속 오답이어도 두 칸은 안 내린다', () => {
    // 로테이션에서 한 검사는 하루 3문항이다. 3시행은 두 칸을 지지할 표본이 아니다.
    expect(adaptedLevel(4, [오답, 오답, 오답])).toBe(3);
    expect(adaptedLevel(4, [오답, 오답, 오답, 오답, 오답])).toBe(3);
  });

  it('내린 뒤의 정답은 승급 근거가 되지 않는다', () => {
    // 쉬워진 문항을 맞힌 것이라 같은 세션에서 되올리면 핑퐁이 된다.
    expect(adaptedLevel(3, [오답, 오답, 정답, 정답, 정답])).toBe(2);
  });

  it('하한과 상한을 넘지 않는다', () => {
    expect(adaptedLevel(MIN_LEVEL, [오답, 오답])).toBe(MIN_LEVEL);
    expect(adaptedLevel(MAX_LEVEL, [정답, 정답, 정답])).toBe(MAX_LEVEL);
    expect(didAdapt(MIN_LEVEL, [오답, 오답])).toBe(false);
  });

  it('범위 밖 시작 레벨은 클램프한다', () => {
    expect(adaptedLevel(0, [])).toBe(MIN_LEVEL);
    expect(adaptedLevel(9, [])).toBe(MAX_LEVEL);
    expect(adaptedLevel(2.6, [])).toBe(3);
  });

  it('강등이 승급보다 먼저 걸린다 — 같은 시점에 둘 다 성립할 수 없다', () => {
    // 연속 오답과 연속 정답은 정의상 동시에 성립하지 않는다. 규칙이 순서에
    // 의존하지 않는다는 것을 고정해 둔다.
    for (const trail of [
      [오답, 오답, 정답, 정답, 정답],
      [정답, 정답, 정답, 오답, 오답],
    ]) {
      expect([2, 4]).toContain(adaptedLevel(3, trail));
    }
  });
});
