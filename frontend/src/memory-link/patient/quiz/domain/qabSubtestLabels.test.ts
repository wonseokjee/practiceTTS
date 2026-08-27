import { describe, expect, it } from 'vitest';
import { QAB_SUBTESTS } from '../../../../../../backend/src/quiz/constants/qab-subtest';
import {
  LEVELED_SUBTESTS,
  NON_LEVELED_SUBTESTS,
  QAB_SUBTEST_LABELS,
  QAB_SUBTEST_ORDER,
  subtestLabel,
} from './qabSubtestLabels.js';
import {
  pickNamingItems,
  pickQabItems,
  pickSentItems,
  pickSpellItems,
} from '../infrastructure/QabItemBank.js';
import {
  pickDdkItems,
  pickReadingItems,
  pickRepeatItems,
} from '../infrastructure/QabSpeechBank.js';

/**
 * 라벨 표는 타입이 전수를 강제하지만, **배열은 못 한다.**
 * 2026-08-17에 spell을 추가하면서 표시 순서와 눈높이 목록을 빠뜨려도 tsc가
 * 통과했고, 보호자 화면에서 항목이 안 보이거나 맨 앞으로 튀었다. 여기서 막는다.
 */
describe('QAB 검사 라벨', () => {
  it('표시 순서가 모든 검사를 빠짐없이 담는다', () => {
    // 누락되면 indexOf가 -1이라 목록 맨 앞으로 튄다.
    const labeled = Object.keys(QAB_SUBTEST_LABELS).sort();
    expect([...QAB_SUBTEST_ORDER].sort()).toEqual(labeled);
  });

  it('순서 배열에 중복이 없다', () => {
    expect(new Set(QAB_SUBTEST_ORDER).size).toBe(QAB_SUBTEST_ORDER.length);
  });

  it('레벨 있는 검사 + 없는 검사 = 전체', () => {
    // 새 검사를 추가하고 어느 쪽에도 안 넣으면 눈높이 카드에서 조용히 사라진다.
    expect([...LEVELED_SUBTESTS, ...NON_LEVELED_SUBTESTS].sort()).toEqual(
      [...QAB_SUBTEST_ORDER].sort(),
    );
  });

  it('모든 라벨이 한글이고 비어 있지 않다', () => {
    for (const [key, label] of Object.entries(QAB_SUBTEST_LABELS)) {
      expect(label.trim().length, `${key} 라벨이 비었다`).toBeGreaterThan(0);
      expect(label, `${key}가 영문 키 그대로 노출된다`).not.toBe(key);
    }
  });

  it('알 수 없는 값이 와도 화면이 깨지지 않는다', () => {
    expect(subtestLabel('unknown_future_subtest')).toBe('unknown_future_subtest');
  });
});

describe('백엔드 상수와의 동기화', () => {
  it('백엔드 QAB_SUBTESTS와 프론트 라벨 키가 일치한다', () => {
    // 백엔드에 검사를 추가하고 프론트 라벨을 안 넣으면 보호자에게 영문 키가 뜬다.
    // 반대로 프론트에만 있으면 서버가 그 결과를 거부한다.
    expect([...QAB_SUBTESTS].sort()).toEqual(
      Object.keys(QAB_SUBTEST_LABELS).sort(),
    );
  });
});

/**
 * LEVELED_SUBTESTS에 있다 = 그 검사가 **실제로** 레벨에 따라 다른 문항을 낸다.
 *
 * 이 테스트가 없으면 목록이 조용히 거짓말한다. 2026-08-17까지 실제로 그랬다 —
 * repeat·reading·ddk는 레벨 인자를 받지도 않았고 sentence는 presentedLevel을
 * 스탬핑만 했는데, 보호자 화면은 loc를 뺀 전부에 1~5단계 눈높이를 표시했다.
 *
 * 각 뱅크의 난이도 규칙 자체는 QabItemBank.test.ts / QabSpeechBank.test.ts가
 * 검증한다. 여기서 보는 건 **목록과 구현의 대응**이다: 목록에 있는 검사는
 * 레벨 1과 레벨 5가 서로 다른 문항 집합을 내야 한다.
 */
describe('LEVELED_SUBTESTS — 목록에 있으면 실제로 적응해야 한다', () => {
  /**
   * 검사별로 (레벨) → 낸 문항 식별자 집합. 무작위라 여러 번 뽑아 합친다.
   *
   * 요청 개수는 실제 세션 규모(검사당 1~2문항)를 쓴다. 레벨별 후보보다 많이
   * 요청하면 의도된 폴백(범위를 풀어 세션을 채운다)이 걸려 모든 레벨이 같은
   * 집합을 내게 된다 — 그건 적응이 없어서가 아니라 요청이 과해서다.
   * 말운동은 밴드가 비누적이라 SMR 자극이 '퍼터커' 1개뿐이다(표준 DDK 세트).
   * 그래서 말운동만 1문항으로 뽑는다 — 2를 요청하면 폴백이 AMR을 끌어와
   * 비누적성이 테스트에서만 깨진다.
   */
  const N = 2;
  const 추출: Record<string, (lv: number) => string[]> = {
    word: (lv) => pickQabItems(N, { word: lv, sentence: lv }).map((i) => i.itemId),
    sentence: (lv) => pickSentItems(N, lv).map((i) => i.itemId),
    naming: (lv) => pickNamingItems(N, lv).map((i) => i.itemId),
    repeat: (lv) => pickRepeatItems(N, lv).map((i) => i.text),
    reading: (lv) => pickReadingItems(N, lv).map((i) => i.text),
    spell: (lv) => pickSpellItems(N, lv).map((i) => i.itemId),
    // 난이도가 자극뿐 아니라 반복 요구량에도 실려 있으므로 둘을 함께 본다.
    ddk: (lv) => pickDdkItems(1, lv).map((i) => `${i.syllable}@${i.targetCount}`),
  };

  const 모아서 = (fn: (lv: number) => string[], lv: number): Set<string> =>
    new Set(Array.from({ length: 30 }, () => fn(lv)).flat());

  it('LEVELED_SUBTESTS의 모든 검사에 난이도 규칙이 등록돼 있다', () => {
    // 새 검사를 목록에 넣고 여기 추출기를 안 만들면 바로 걸린다.
    expect(Object.keys(추출).sort()).toEqual([...LEVELED_SUBTESTS].sort());
  });

  it.each([...LEVELED_SUBTESTS])(
    '%s: 레벨 1과 레벨 5가 다른 문항을 낸다',
    (subtest) => {
      const low = 모아서(추출[subtest], 1);
      const high = 모아서(추출[subtest], 5);

      // 완전히 같은 집합이면 레벨이 아무것도 안 하는 것이다.
      expect([...high].some((x) => !low.has(x)) || [...low].some((x) => !high.has(x))).toBe(true);
    },
  );

  it('loc는 레벨 대상이 아니다 — 의식 수준은 눈높이 개념이 없다', () => {
    expect(LEVELED_SUBTESTS).not.toContain('loc');
    expect(NON_LEVELED_SUBTESTS).toContain('loc');
  });
});
