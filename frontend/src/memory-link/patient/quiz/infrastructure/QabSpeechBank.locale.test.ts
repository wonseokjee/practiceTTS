// QabSpeechBank — 로케일별 뱅크(영어판 M2 ②)
//
// 검증 포인트:
//  - 로케일을 안 주면 예전과 같다(한국어, 접두 없는 id)
//  - 영어 문항은 영어 파일에서, id에 로케일 접두, 영어 지시문
//  - 영어 풀이 모자라도 한국어로 채우지 않는다(콘텐츠를 채우는 중이다)
//  - 겹침 방지(exclude)가 접두 붙은 id로 동작한다

import { describe, expect, it } from 'vitest';
import en from '../../../../assets/data/qabSpeechStimuli.en-US.json';
import {
  pickDdkItems,
  pickReadingItems,
  pickRepeatItems,
} from './QabSpeechBank.js';

const EN = { locale: 'en-US' };
const HANGUL = /[가-힣]/;
const enSyllables = new Map(
  (en.repeatWords as { text: string; syllables: number }[]).map((w) => [
    w.text,
    w.syllables,
  ]),
);

/** 여러 번 뽑아 모은다 — 무작위라 한 번으로는 밴드를 다 못 본다. */
function many<T>(pick: () => T[], times = 40): T[] {
  return Array.from({ length: times }, pick).flat();
}

describe('QabSpeechBank — 로케일', () => {
  it('로케일을 안 주면 한국어 — id에 접두가 없다(저장된 결과와 호환)', () => {
    for (const it of many(() => pickRepeatItems(3, 2))) {
      expect(it.itemId).toMatch(/^repeat_w\d+$/);
      expect(it.text).toMatch(HANGUL);
    }
  });

  it('영어 lv1·lv2 — 영어 낱말만, 저장된 음절로 밴드를 지킨다', () => {
    for (const [lv, min, max] of [
      [1, 1, 2],
      [2, 2, 3],
    ] as const) {
      for (const it of many(() => pickRepeatItems(3, lv, EN))) {
        expect(it.itemId).toMatch(/^en-US:repeat_w\d+$/);
        expect(it.category).toBe('word');
        const syl = enSyllables.get(it.text);
        expect(syl, it.text).toBeDefined();
        expect(syl!, `${it.text} lv${lv}`).toBeGreaterThanOrEqual(min);
        expect(syl!, `${it.text} lv${lv}`).toBeLessThanOrEqual(max);
        expect(it.bandFallback).toBeUndefined();
        expect(it.instruction).not.toMatch(HANGUL);
      }
    }
  });

  it('영어 세션에 한국어 문항이 섞이지 않는다 — 풀이 모자라도(문장·읽기·DDK)', () => {
    const all = [
      ...many(() => pickRepeatItems(3, 3, EN)),
      ...many(() => pickRepeatItems(3, 4, EN)),
      ...many(() => pickRepeatItems(3, 5, EN)),
      ...many(() => pickReadingItems(3, 1, EN)),
      ...many(() => pickReadingItems(3, 5, EN)),
      ...many(() => pickDdkItems(3, 3, EN)),
    ];
    for (const it of all) {
      const text = 'text' in it ? it.text : it.label;
      expect(text, it.itemId).not.toMatch(HANGUL);
      expect(it.itemId.startsWith('en-US:'), it.itemId).toBe(true);
    }
  });

  it('겹침 방지는 접두 붙은 id로 — 방금 낸 영어 문항을 다시 안 낸다', () => {
    const first = pickRepeatItems(5, 2, EN);
    const exclude = new Set(first.map((i) => i.itemId));
    const second = pickRepeatItems(5, 2, { ...EN, exclude });
    for (const it of second) expect(exclude.has(it.itemId), it.itemId).toBe(false);
  });

  it('한국어 세션은 영어 문항을 안 낸다', () => {
    for (const it of many(() => pickRepeatItems(3, 1, { locale: 'ko-KR' }))) {
      expect(it.itemId.startsWith('en-US:')).toBe(false);
    }
  });
});
