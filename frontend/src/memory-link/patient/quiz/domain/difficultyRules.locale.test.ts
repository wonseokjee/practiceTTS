// 로케일별 발화 밴드 — 한국어는 그대로, 영어 문장은 단어 수(D1)

import { describe, expect, it } from 'vitest';
import {
  readingBandForLevel,
  readingRangeForLevel,
  repeatBandsForLevel,
  repeatSpecForLevel,
} from './difficultyRules.js';

const LEVELS = [1, 2, 3, 4, 5];

describe('repeatBandsForLevel / readingBandForLevel', () => {
  it('로케일을 안 주거나 한국어면 기존 규칙과 같다 — 한국어 동작이 안 바뀐다', () => {
    for (const lv of LEVELS) {
      const spec = repeatSpecForLevel(lv);
      for (const locale of [undefined, 'ko-KR']) {
        const bands = repeatBandsForLevel(lv, locale);
        expect(bands.kind).toBe(spec.kind);
        expect(bands.word).toEqual(
          spec.kind === 'sentence' ? null : { min: spec.min, max: spec.max },
        );
        expect(bands.sentence).toEqual(
          spec.kind === 'word' ? null : { min: spec.min, max: spec.max },
        );
        expect(readingBandForLevel(lv, locale)).toEqual(readingRangeForLevel(lv));
      }
    }
  });

  it('영어 따라말하기 — 낱말은 한국어와 같은 음절, 문장은 단어 수(설계 §3-3)', () => {
    const en = LEVELS.map((lv) => repeatBandsForLevel(lv, 'en-US'));
    expect(en.map((b) => b.word)).toEqual([
      { min: 1, max: 2 },
      { min: 2, max: 3 },
      { min: 3, max: 4 },
      null,
      null,
    ]);
    expect(en.map((b) => b.sentence)).toEqual([
      null,
      null,
      { min: 5, max: 6 },
      { min: 5, max: 8 },
      { min: 8, max: 11 },
    ]);
  });

  it('영어 읽기 — 3 · 3~5 · 5~6 · 6~8 · 8~11단어', () => {
    expect(LEVELS.map((lv) => readingBandForLevel(lv, 'en-US'))).toEqual([
      { min: 3, max: 3 },
      { min: 3, max: 5 },
      { min: 5, max: 6 },
      { min: 6, max: 8 },
      { min: 8, max: 11 },
    ]);
  });

  it('레벨을 모르면 콜드스타트(2) — 영어도 같다', () => {
    expect(readingBandForLevel(undefined, 'en-US')).toEqual({ min: 3, max: 5 });
    expect(repeatBandsForLevel(undefined, 'en-US').word).toEqual({ min: 2, max: 3 });
  });
});
