// QabItemBank.ts — QAB 질문형(단어/문장) 뱅크 테스트

import { describe, expect, it } from 'vitest';
import {
  pickNamingItems,
  pickQabItems,
  pickSentItems,
  pickWordItems,
  qabItemCount,
  WORD_CATEGORY,
} from './QabItemBank.js';

/** 선택지 imageUrl("/…/apple.svg")에서 slug를 뽑는다. */
function slugOf(url: string): string {
  return url.split('/').pop()!.replace(/\.[^.]+$/, '');
}

describe('QabItemBank', () => {
  it('pickQabItems: 요청 개수만큼(한도 내) 반환한다', () => {
    expect(pickQabItems(5)).toHaveLength(5);
  });

  it('pickQabItems: 뱅크보다 많이 요청하면 전체만 반환한다', () => {
    expect(pickQabItems(qabItemCount() + 100)).toHaveLength(qabItemCount());
  });

  it('pickQabItems: word/sentence가 섞여 나온다(충분히 뽑으면 두 종류 모두 등장)', () => {
    const cats = new Set(pickQabItems(qabItemCount()).map((i) => i.category));
    expect(cats.has('word')).toBe(true);
    expect(cats.has('sentence')).toBe(true);
  });

  it('각 문항은 정답 선택지를 정확히 1개 가진다(isCorrect 보존)', () => {
    for (const item of pickQabItems(8)) {
      const correct = item.choices.filter((c) => c.isCorrect);
      expect(correct).toHaveLength(1);
      expect(item.promptText.length).toBeGreaterThan(0);
      expect(item.instruction.length).toBeGreaterThan(0);
      expect(item.choices.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('pickWordItems는 word, pickSentItems는 sentence만 반환한다', () => {
    expect(pickWordItems(3).every((i) => i.category === 'word')).toBe(true);
    expect(pickSentItems(3).every((i) => i.category === 'sentence')).toBe(true);
  });

  it('단어이해: 4보기가 모두 서로 다른 그림/라벨이다(중복 유인지 없음)', () => {
    for (const item of pickWordItems(30)) {
      expect(item.choices).toHaveLength(4);
      const urls = new Set(item.choices.map((c) => c.imageUrl));
      const labels = new Set(item.choices.map((c) => c.label));
      expect(urls.size).toBe(4);
      expect(labels.size).toBe(4);
      expect(item.choices.filter((c) => c.isCorrect)).toHaveLength(1);
    }
  });

  it('단어이해: 큰 범주(동물/음식/사물) 정답은 같은 범주 유인지를 최소 2개 포함한다', () => {
    // 통제된 유인지: 범주만 알고는 못 맞추도록 같은 범주 오답을 우선 배치한다.
    const big = new Set(['animal', 'food', 'object']);
    for (const item of pickWordItems(60)) {
      const correct = item.choices.find((c) => c.isCorrect)!;
      const cat = WORD_CATEGORY[slugOf(correct.imageUrl)] ?? 'object';
      if (!big.has(cat)) continue;
      const sameCatDistractors = item.choices.filter(
        (c) => !c.isCorrect && (WORD_CATEGORY[slugOf(c.imageUrl)] ?? 'object') === cat,
      );
      expect(sameCatDistractors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('0개 요청 시 빈 배열', () => {
    expect(pickQabItems(0)).toEqual([]);
  });

  it('pickNamingItems: 요청 개수만큼, 그림 URL과 정답 이름을 가진다', () => {
    const items = pickNamingItems(3);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.itemId.startsWith('naming_')).toBe(true);
      expect(item.imageUrl.length).toBeGreaterThan(0);
      expect(item.targetWord.length).toBeGreaterThan(0);
      expect(item.instruction.length).toBeGreaterThan(0);
    }
  });

  it('pickNamingItems: 사진이 준비된 단어는 실물 사진을 쓴다', () => {
    // 고령·치매 환자는 선화보다 실물 사진에 더 잘 반응한다(산출 과제).
    // namingPhotos.json에 등록된 단어는 /naming/<slug>.png를 써야 한다.
    // 전체를 뽑아 사과가 반드시 포함되게 한다(무작위 추출이라 일부만 뽑으면 빠질 수 있다).
    const items = pickNamingItems(100);
    const apple = items.find((i) => i.targetWord === '사과');

    // 사과 사진이 등록돼 있으므로 png 경로여야 한다.
    expect(apple?.imageUrl).toBe('/assets/images/naming/apple.png');
  });

  it('pickNamingItems: 사진이 없는 단어는 SVG로 폴백한다', () => {
    // 사진을 20개 다 갖추기 전에도 검사가 깨지면 안 된다.
    // 사진 없는 단어는 단어이해 SVG를 그대로 쓴다.
    const items = pickNamingItems(100);
    const withoutPhoto = items.filter(
      (i) => i.imageUrl.includes('/wordComp/'),
    );

    // 아직 대부분은 SVG 폴백이다.
    expect(withoutPhoto.length).toBeGreaterThan(0);
    for (const item of withoutPhoto) {
      expect(item.imageUrl).toMatch(/\.svg$/);
    }
  });

  it('pickNamingItems: 0개 요청 시 빈 배열', () => {
    expect(pickNamingItems(0)).toEqual([]);
  });
});
