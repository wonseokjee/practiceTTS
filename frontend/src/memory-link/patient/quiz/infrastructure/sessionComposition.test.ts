// 로테이션이 약속한 세션 구성을 실제 문항 뱅크가 감당하는지.
//
// subtestRotation.test.ts는 순환 규칙만 본다(어느 검사를 낼지). 여기서는 그 검사가
// **정말 3문항을 낼 수 있는지**를 진짜 뱅크로 확인한다. 규칙이 맞아도 풀이 얕으면
// 폴백이 걸려 레벨이 조용히 어긋나므로, 둘은 따로 검증해야 한다.

import { describe, expect, it } from 'vitest';
import {
  ITEMS_PER_SUBTEST,
  ROTATION_ORDER,
  SUBTESTS_PER_SESSION,
  rotationForDay,
} from '../domain/subtestRotation.js';
import type { QabSubtest } from '../domain/QabResult.js';
import {
  pickNamingItems,
  pickSentItems,
  pickSpellItems,
  pickWordItems,
} from './QabItemBank.js';
import {
  pickDdkItems,
  pickReadingItems,
  pickRepeatItems,
} from './QabSpeechBank.js';

const 추출: Record<QabSubtest, (n: number, lv: number) => { itemId: string }[]> =
  {
    word: (n, lv) => pickWordItems(n, lv),
    sentence: (n, lv) => pickSentItems(n, lv),
    // 이름대기는 비레벨 검사라 레벨을 받지 않는다 — 그래도 로테이션에는 든다.
    naming: (n) => pickNamingItems(n),
    spell: (n, lv) => pickSpellItems(n, lv),
    repeat: (n, lv) => pickRepeatItems(n, lv),
    reading: (n, lv) => pickReadingItems(n, lv),
    ddk: (n, lv) => pickDdkItems(n, lv),
    loc: () => [],
  };

const LEVELS = [1, 2, 3, 4, 5];

describe('세션 구성 — 로테이션이 요구하는 문항 수를 뱅크가 낼 수 있나', () => {
  it.each([...ROTATION_ORDER])(
    '%s: 모든 레벨에서 3문항을 채운다',
    (subtest) => {
      for (const lv of LEVELS) {
        const items = 추출[subtest](ITEMS_PER_SUBTEST, lv);
        expect(items, `${subtest} lv${lv}`).toHaveLength(ITEMS_PER_SUBTEST);
      }
    },
  );

  it.each([...ROTATION_ORDER])(
    '%s: 3문항이 서로 다른 문항이다 — 같은 문항을 반복하면 3시행이 아니다',
    (subtest) => {
      // 세션 내 적응은 "2연속 오답 → 내린다"를 3시행으로 판정한다. 같은 문항이
      // 반복되면 시행이 독립적이지 않아 판정이 의미를 잃는다.
      for (const lv of LEVELS) {
        const ids = 추출[subtest](ITEMS_PER_SUBTEST, lv).map((i) => i.itemId);
        expect(new Set(ids).size, `${subtest} lv${lv}: ${ids.join(',')}`).toBe(
          ITEMS_PER_SUBTEST,
        );
      }
    },
  );

  it('어느 요일이든 QAB 문항 수는 9다', () => {
    for (let d = 0; d < 7; d += 1) {
      const total = rotationForDay(d)
        .map((s) => 추출[s](ITEMS_PER_SUBTEST, 3).length)
        .reduce((a, b) => a + b, 0);
      expect(total, `day ${d}`).toBe(SUBTESTS_PER_SESSION * ITEMS_PER_SUBTEST);
    }
  });
});
