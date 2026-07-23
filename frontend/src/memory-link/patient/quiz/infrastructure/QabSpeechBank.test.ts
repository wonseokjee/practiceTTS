// QabSpeechBank.ts — 발화 검사 자극 뱅크 테스트

import { describe, expect, it } from 'vitest';
import {
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
