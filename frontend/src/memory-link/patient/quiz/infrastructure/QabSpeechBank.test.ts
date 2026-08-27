// QabSpeechBank.ts — 발화 검사 자극 뱅크 테스트

import { describe, expect, it } from 'vitest';
import {
  ddkSpecForLevel,
  pickDdkItems,
  pickReadingItems,
  pickRepeatItems,
} from './QabSpeechBank.js';

describe('QabSpeechBank', () => {
  it('pickRepeatItems: 요청 개수만큼, 단어/문장 카테고리를 가진다', () => {
    const items = pickRepeatItems(4);
    expect(items).toHaveLength(4);
    for (const it of items) {
      expect(it.text.length).toBeGreaterThan(0);
      expect(['word', 'sentence']).toContain(it.category);
      expect(it.instruction.length).toBeGreaterThan(0);
    }
  });

  it('pickReadingItems: 요청 개수만큼 텍스트 문항을 반환', () => {
    const items = pickReadingItems(3);
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.text.length).toBeGreaterThan(0);
    }
  });

  it('pickDdkItems: 음절/목표횟수를 가진다', () => {
    const items = pickDdkItems(2);
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.syllable.length).toBeGreaterThan(0);
      expect(it.label.length).toBeGreaterThan(0);
      expect(it.targetCount).toBeGreaterThan(0);
    }
  });

  it('0개 요청 시 빈 배열', () => {
    expect(pickRepeatItems(0)).toEqual([]);
    expect(pickReadingItems(0)).toEqual([]);
    expect(pickDdkItems(0)).toEqual([]);
  });
});

/**
 * 레벨별 난이도 통제.
 *
 * 이 셋은 예전에 레벨을 **받지도 않고** 문항을 골랐다. 그런데 보호자 화면은
 * loc를 뺀 모든 검사에 1~5단계 눈높이가 있다고 표시했다 — 같은 과제를 계속
 * 내면서 숫자만 오르내리는 구조였고, 재활 앱에서 그건 보호자의 임상 판단을
 * 오염시키는 거짓 신호다.
 *
 * 그래서 여기서 검증하는 건 "레벨 인자를 받는다"가 아니라 **레벨이 실제로 다른
 * 문항을 고른다**는 것이다. 인자만 받고 무시해도 통과하는 테스트는 의미가 없다.
 *
 * 요청 개수는 실제 세션 규모(검사당 1~3문항)에 맞춘다. 레벨별 후보보다 많이
 * 요청하면 의도된 폴백(범위를 풀어 세션을 채운다)이 걸려 범위 밖 문항이 나온다 —
 * 그건 결함이 아니라 설계이므로 따로 검증한다.
 */
describe('QabSpeechBank — 레벨별 난이도', () => {
  const 어절 = (s: string): number => s.trim().split(/\s+/).length;
  const 음절 = (s: string): number => Array.from(s.replace(/\s+/g, '')).length;
  /** 무작위 추출이라 한 번으로는 못 믿는다 — 여러 번 뽑아 합친다. */
  const 반복추출 = <T,>(pick: () => T[], times = 20): T[] =>
    Array.from({ length: times }, pick).flat();

  describe('따라말하기', () => {
    it('레벨 1은 1~2음절 단어만 낸다 — 문장은 청각 작업기억까지 요구한다', () => {
      const items = 반복추출(() => pickRepeatItems(3, 1));

      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        expect(it.category).toBe('word');
        expect(음절(it.text)).toBeLessThanOrEqual(2);
      }
    });

    it('레벨 5는 5~7어절 문장만 낸다', () => {
      const items = 반복추출(() => pickRepeatItems(3, 5));

      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        expect(it.category).toBe('sentence');
        expect(어절(it.text)).toBeGreaterThanOrEqual(5);
        expect(어절(it.text)).toBeLessThanOrEqual(7);
      }
    });

    it('레벨 1과 5의 문항이 전혀 겹치지 않는다 — 겹치면 눈높이가 무의미하다', () => {
      const low = new Set(반복추출(() => pickRepeatItems(3, 1)).map((i) => i.text));
      const high = 반복추출(() => pickRepeatItems(3, 5)).map((i) => i.text);

      expect(high.every((t) => !low.has(t))).toBe(true);
    });

    it('레벨을 안 주면 콜드스타트(2)로 떨어진다 — 백엔드와 같은 값', () => {
      for (const it of 반복추출(() => pickRepeatItems(3))) {
        expect(it.category).toBe('word');
        expect(음절(it.text)).toBeGreaterThanOrEqual(2);
        expect(음절(it.text)).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('소리 내어 읽기', () => {
    it('레벨이 오르면 문장이 길어진다', () => {
      const low = 반복추출(() => pickReadingItems(2, 1));
      const high = 반복추출(() => pickReadingItems(2, 5));

      const maxLow = Math.max(...low.map((i) => 어절(i.text)));
      const minHigh = Math.min(...high.map((i) => 어절(i.text)));
      expect(minHigh).toBeGreaterThan(maxLow);
    });

    it('어떤 레벨에서도 7어절을 넘지 않는다 — 그보다 길면 검사가 아니라 좌절이다', () => {
      for (const lv of [1, 2, 3, 4, 5]) {
        for (const it of 반복추출(() => pickReadingItems(2, lv), 5)) {
          expect(어절(it.text)).toBeLessThanOrEqual(7);
        }
      }
    });
  });

  describe('말운동(DDK)', () => {
    it('낮은 레벨은 AMR(단음절)만 낸다', () => {
      // SMR('퍼터커')은 조음 위치를 바꿔가며 내야 해서 구음장애에서 먼저 무너진다.
      for (const lv of [1, 2, 3]) {
        for (const it of 반복추출(() => pickDdkItems(1, lv))) {
          expect(음절(it.syllable)).toBe(1);
        }
      }
    });

    it('레벨 4는 전환 1회(2음절), 레벨 5는 전환 2회(3음절)만 낸다', () => {
      // SMR 자극이 '퍼터커' 하나뿐이면 로테이션의 3문항을 폴백 없이 못 채운다.
      // 전환 수로 두 밴드를 갈라 각 밴드에 자극 3개씩을 두었다.
      for (const it of 반복추출(() => pickDdkItems(1, 4))) {
        expect(음절(it.syllable)).toBe(2);
      }
      for (const it of 반복추출(() => pickDdkItems(1, 5))) {
        expect(음절(it.syllable)).toBe(3);
      }
    });

    it('높은 레벨은 SMR만 낸다 — 밴드가 누적되지 않는다', () => {
      // 예전엔 `allowSmr || 단음절`이라 레벨 5가 AMR을 그대로 낼 수 있었다.
      // 그러면 레벨 5로 기록된 문항이 실제로는 레벨 1 문항이다(#59·#60과 같은 버그).
      for (const lv of [4, 5]) {
        for (const it of 반복추출(() => pickDdkItems(1, lv))) {
          expect(음절(it.syllable)).toBeGreaterThan(1);
        }
      }
    });

    it('다섯 레벨이 서로 다른 요구를 낸다 — 종류가 같아도 반복 횟수가 다르다', () => {
      // 종류(AMR/SMR)만으로는 밴드가 둘뿐이다. 표준 자극이 AMR 3 + SMR 1이라
      // 자극을 늘려 해결할 수 없으므로 반복 요구량이 두 번째 축이다.
      const 요구 = [1, 2, 3, 4, 5].map((lv) => {
        const spec = ddkSpecForLevel(lv);
        return `${spec.kind}:${spec.targetCount}`;
      });

      expect(new Set(요구).size).toBe(5);
      // 같은 종류 안에서는 레벨이 오를수록 더 많이 요구한다.
      expect(ddkSpecForLevel(1).targetCount).toBeLessThan(ddkSpecForLevel(2).targetCount);
      expect(ddkSpecForLevel(2).targetCount).toBeLessThan(ddkSpecForLevel(3).targetCount);
      expect(ddkSpecForLevel(4).targetCount).toBeLessThan(ddkSpecForLevel(5).targetCount);
    });

    it('모든 밴드에 자극이 3개 이상이다 — 로테이션의 3문항을 폴백 없이 채운다', () => {
      // 폴백이 걸리면 밴드가 다시 섞여 레벨 기록이 거짓이 된다(E6가 그 버그였다).
      for (const lv of [1, 2, 3, 4, 5]) {
        const ids = new Set(pickDdkItems(3, lv).map((i) => i.itemId));
        expect(ids.size, `lv${lv}`).toBe(3);
      }
      // 그리고 그 3개가 전부 같은 밴드다.
      for (const lv of [1, 2, 3, 4, 5]) {
        const 음절수 = pickDdkItems(3, lv).map((i) => 음절(i.syllable));
        expect(new Set(음절수).size, `lv${lv}: ${음절수.join(',')}`).toBe(1);
      }
    });

    it('추출한 문항의 목표 횟수는 레벨이 정한다', () => {
      for (const lv of [1, 2, 3, 4, 5]) {
        const spec = ddkSpecForLevel(lv);
        for (const it of 반복추출(() => pickDdkItems(1, lv))) {
          expect(it.targetCount).toBe(spec.targetCount);
        }
      }
    });
  });

  it('레벨 범위의 문항이 부족하면 범위를 풀어 세션이 비지 않게 한다', () => {
    // 문항이 조용히 사라지는 것보다 난이도가 조금 어긋나는 편이 낫다.
    // 후보(레벨1 읽기는 3개)보다 많이 요청하면 폴백이 걸려 그만큼 채워진다.
    expect(pickReadingItems(10, 1).length).toBeGreaterThan(3);
    expect(pickDdkItems(4, 1).length).toBe(4);
  });
});
