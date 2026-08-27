// 난이도 규칙 자체의 무결성 — 뱅크 없이 규칙만 본다.
//
// 각 축이 "레벨 4에서 무엇을 내는가"는 뱅크 테스트가 실제 문항으로 확인한다.
// 여기서 보는 건 **표 자체가 성립하는가**다: 다섯 레벨에 빠짐없이 값이 있는지,
// 범위 밖 입력이 접히는지, 한 축 안에서 방향이 뒤집히지 않는지.
//
// 규칙이 뱅크 안에 있을 때는 이걸 따로 볼 수 없었다(D2).

import { describe, expect, it } from 'vitest';
import {
  COLD_START_LEVEL,
  LEVEL_CHOICE_SPEC,
  MAX_LEVEL,
  MIN_LEVEL,
  choiceSpecForLevel,
  ddkSpecForLevel,
  distractorCountForLevel,
  normalizeLevel,
  readingRangeForLevel,
  repeatSpecForLevel,
  sentTypeForLevel,
} from './difficultyRules.js';

const LEVELS = [1, 2, 3, 4, 5];

describe('normalizeLevel', () => {
  it('범위 밖은 접고 소수는 반올림한다', () => {
    expect(normalizeLevel(0)).toBe(MIN_LEVEL);
    expect(normalizeLevel(-7)).toBe(MIN_LEVEL);
    expect(normalizeLevel(9)).toBe(MAX_LEVEL);
    expect(normalizeLevel(2.6)).toBe(3);
  });

  it('미지정은 콜드스타트다', () => {
    // 이 값이 축마다 갈라진 적이 있다 — 두 곳은 2, 한 곳은 3이었다(D4).
    // 인자로 받지 않으므로 이제 갈라질 수 없다.
    expect(normalizeLevel(undefined)).toBe(COLD_START_LEVEL);
  });
});

describe('모든 축이 다섯 레벨을 빠짐없이 정의한다', () => {
  // 표에 구멍이 있으면 그 레벨에서 undefined가 흘러 문항이 통째로 깨진다.
  it.each(LEVELS)('레벨 %i', (lv) => {
    expect(LEVEL_CHOICE_SPEC[lv]).toBeDefined();
    expect(choiceSpecForLevel(lv)).toBeDefined();
    expect(distractorCountForLevel(lv)).toBeTypeOf('number');
    expect(sentTypeForLevel(lv)).toBeTruthy();
    expect(repeatSpecForLevel(lv)).toBeDefined();
    expect(readingRangeForLevel(lv)).toBeDefined();
    expect(ddkSpecForLevel(lv)).toBeDefined();
  });
});

describe('축 안에서 방향이 뒤집히지 않는다', () => {
  it('선택지는 줄지 않는다', () => {
    for (let lv = 1; lv < 5; lv += 1) {
      expect(
        LEVEL_CHOICE_SPEC[lv + 1].total,
        `lv${lv}→${lv + 1}`,
      ).toBeGreaterThanOrEqual(LEVEL_CHOICE_SPEC[lv].total);
    }
  });

  it('의미 오답은 2를 넘지 않는다', () => {
    // 가장 작은 범주가 3개(정답 + 동료 2)다. 3을 요구하면 채울 수 없는 낱말이
    // 생기고, 못 채운 자리가 조용히 메워져 레벨이 거짓말을 한다(#59).
    for (const lv of LEVELS) {
      expect(LEVEL_CHOICE_SPEC[lv].sameCat, `lv${lv}`).toBeLessThanOrEqual(2);
    }
  });

  it('방해 타일은 줄지 않고 0·2·4만 쓴다', () => {
    // 등급값은 상용 실어증 치료 도구의 관례다. 5단계는 축을 엇갈려 만들지
    // 중간값(1·3)을 지어내서 만들지 않는다.
    for (const lv of LEVELS) {
      expect([0, 2, 4]).toContain(distractorCountForLevel(lv));
    }
    for (let lv = 1; lv < 5; lv += 1) {
      expect(distractorCountForLevel(lv + 1)).toBeGreaterThanOrEqual(
        distractorCountForLevel(lv),
      );
    }
  });

  it('읽기 문장은 길어지기만 하고 7어절을 넘지 않는다', () => {
    // 그보다 길면 검사가 아니라 좌절 경험이 된다.
    for (let lv = 1; lv < 5; lv += 1) {
      const a = readingRangeForLevel(lv);
      const b = readingRangeForLevel(lv + 1);
      expect(b.min).toBeGreaterThanOrEqual(a.min);
      expect(b.max).toBeGreaterThanOrEqual(a.max);
    }
    for (const lv of LEVELS) {
      expect(readingRangeForLevel(lv).max).toBeLessThanOrEqual(7);
      expect(readingRangeForLevel(lv).min).toBeLessThanOrEqual(
        readingRangeForLevel(lv).max,
      );
    }
  });

  it('따라말하기는 단어에서 문장으로만 간다', () => {
    const 순서 = { word: 0, mixed: 1, sentence: 2 };
    for (let lv = 1; lv < 5; lv += 1) {
      expect(순서[repeatSpecForLevel(lv + 1).kind]).toBeGreaterThanOrEqual(
        순서[repeatSpecForLevel(lv).kind],
      );
    }
  });

  it('말운동은 전환 수가 줄지 않는다', () => {
    const 전환 = { amr: 0, smr2: 1, smr3: 2 };
    for (let lv = 1; lv < 5; lv += 1) {
      expect(전환[ddkSpecForLevel(lv + 1).kind]).toBeGreaterThanOrEqual(
        전환[ddkSpecForLevel(lv).kind],
      );
    }
  });
});

describe('문장 통사 유형은 비누적이다', () => {
  it('레벨마다 유형이 하나로 정해진다', () => {
    // 누적이면 레벨 5가 레벨 1 문항을 그대로 낼 수 있다 — #60에서 고친 버그다.
    const 유형 = LEVELS.map(sentTypeForLevel);
    expect(유형.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
    expect(sentTypeForLevel(1)).not.toBe(sentTypeForLevel(5));
  });
});
