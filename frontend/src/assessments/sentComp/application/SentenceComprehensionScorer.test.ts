/**
 * 문장 이해 (SentComp) 검사 - 채점 서비스 단위 테스트
 *
 * 외부 의존성 없는 순수 함수이므로 Mock 없이 직접 테스트한다.
 *
 * TC-01: isAnswerCorrect - choices[0].isCorrect=true, selectedIndex=0 → true
 * TC-02: isAnswerCorrect - choices[0].isCorrect=true, selectedIndex=1 → false
 * TC-03: calculateReactionTime(1000, 2500) → 1500
 * TC-04: calculateReactionTime(1100, 1000) → 0 (음수 방지)
 * TC-05: calculateScore - 10문항 모두 정답 → { totalScore: 100, correctCount: 10 }
 * TC-06: calculateScore - active-passive 4문항(3정답), relative-clause 4문항(2정답),
 *         embedded-clause 2문항(1정답) → byType['active-passive'].rate=0.75, ..., totalScore=60
 * TC-07: calculateScore - embedded-clause 문항 없음 → byType['embedded-clause'].rate = null
 */

import { describe, it, expect } from 'vitest';
import {
  isAnswerCorrect,
  calculateReactionTime,
  calculateScore,
} from './SentenceComprehensionScorer.js';
import type {
  SentenceComprehensionItem,
  SentenceComprehensionResult,
} from '../domain/types.js';

// ===== 테스트 픽스처 헬퍼 =====

function makeItem(
  itemId: string,
  sentenceType: SentenceComprehensionItem['sentenceType'],
  correctIndex: 0 | 1,
  orderIndex: number,
): SentenceComprehensionItem {
  const choices: [
    { imageUrl: string; altText: string; isCorrect: boolean },
    { imageUrl: string; altText: string; isCorrect: boolean },
  ] = [
    {
      imageUrl: `/img/${itemId}_0.webp`,
      altText: `${itemId} 선택지 0`,
      isCorrect: correctIndex === 0,
    },
    {
      imageUrl: `/img/${itemId}_1.webp`,
      altText: `${itemId} 선택지 1`,
      isCorrect: correctIndex === 1,
    },
  ];
  return Object.freeze({
    itemId,
    sentence: `${itemId} 테스트 문장`,
    sentenceAudioUrl: `/audio/${itemId}.mp3`,
    sentenceType,
    choices,
    orderIndex,
  });
}

function makeResult(
  itemId: string,
  selectedImageIndex: 0 | 1,
  isCorrect: boolean,
  reactionTimeMs = 1000,
  replayCount = 0,
): SentenceComprehensionResult {
  return Object.freeze({
    itemId,
    selectedImageIndex,
    isCorrect,
    reactionTimeMs,
    replayCount,
    audioEndTimestamp: 1000,
    selectionTimestamp: 1000 + reactionTimeMs,
  });
}

// ===== isAnswerCorrect 테스트 =====

describe('isAnswerCorrect', () => {
  it('TC-01: choices[0].isCorrect=true, selectedIndex=0 → true', () => {
    const item = makeItem('item_01', 'active-passive', 0, 0);
    expect(isAnswerCorrect(item, 0)).toBe(true);
  });

  it('TC-02: choices[0].isCorrect=true, selectedIndex=1 → false', () => {
    const item = makeItem('item_02', 'active-passive', 0, 0);
    expect(isAnswerCorrect(item, 1)).toBe(false);
  });

  it('choices[1].isCorrect=true, selectedIndex=1 → true', () => {
    const item = makeItem('item_03', 'relative-clause', 1, 0);
    expect(isAnswerCorrect(item, 1)).toBe(true);
  });

  it('choices[1].isCorrect=true, selectedIndex=0 → false', () => {
    const item = makeItem('item_04', 'relative-clause', 1, 0);
    expect(isAnswerCorrect(item, 0)).toBe(false);
  });
});

// ===== calculateReactionTime 테스트 =====

describe('calculateReactionTime', () => {
  it('TC-03: calculateReactionTime(1000, 2500) → 1500', () => {
    expect(calculateReactionTime(1000, 2500)).toBe(1500);
  });

  it('TC-04: calculateReactionTime(1100, 1000) → 0 (음수 방지)', () => {
    expect(calculateReactionTime(1100, 1000)).toBe(0);
  });

  it('동일한 타임스탬프이면 0을 반환한다', () => {
    expect(calculateReactionTime(500, 500)).toBe(0);
  });

  it('정상적인 반응 시간 계산 - 큰 값', () => {
    expect(calculateReactionTime(0, 3000)).toBe(3000);
  });
});

// ===== calculateScore 테스트 =====

describe('calculateScore', () => {
  it('TC-05: 10문항 모두 정답 → totalScore=100, correctCount=10', () => {
    const items: SentenceComprehensionItem[] = [
      makeItem('s01', 'active-passive', 0, 0),
      makeItem('s02', 'active-passive', 1, 1),
      makeItem('s03', 'active-passive', 0, 2),
      makeItem('s04', 'active-passive', 1, 3),
      makeItem('s05', 'relative-clause', 0, 4),
      makeItem('s06', 'relative-clause', 1, 5),
      makeItem('s07', 'relative-clause', 0, 6),
      makeItem('s08', 'relative-clause', 1, 7),
      makeItem('s09', 'embedded-clause', 0, 8),
      makeItem('s10', 'embedded-clause', 1, 9),
    ];

    const results: SentenceComprehensionResult[] = items.map((item) =>
      makeResult(item.itemId, item.choices[0].isCorrect ? 0 : 1, true),
    );

    const score = calculateScore(items, results);

    expect(score.totalScore).toBe(100);
    expect(score.correctCount).toBe(10);
    expect(score.totalItems).toBe(10);
  });

  it('TC-06: active-passive 4문항(3정답), relative-clause 4문항(2정답), embedded-clause 2문항(1정답) → 유형별 정답률 및 totalScore=60', () => {
    const items: SentenceComprehensionItem[] = [
      // active-passive: 4문항
      makeItem('ap01', 'active-passive', 0, 0),
      makeItem('ap02', 'active-passive', 0, 1),
      makeItem('ap03', 'active-passive', 0, 2),
      makeItem('ap04', 'active-passive', 0, 3),
      // relative-clause: 4문항
      makeItem('rc01', 'relative-clause', 0, 4),
      makeItem('rc02', 'relative-clause', 0, 5),
      makeItem('rc03', 'relative-clause', 0, 6),
      makeItem('rc04', 'relative-clause', 0, 7),
      // embedded-clause: 2문항
      makeItem('ec01', 'embedded-clause', 0, 8),
      makeItem('ec02', 'embedded-clause', 0, 9),
    ];

    const results: SentenceComprehensionResult[] = [
      // active-passive: 3정답, 1오답
      makeResult('ap01', 0, true),
      makeResult('ap02', 0, true),
      makeResult('ap03', 0, true),
      makeResult('ap04', 1, false), // 오답
      // relative-clause: 2정답, 2오답
      makeResult('rc01', 0, true),
      makeResult('rc02', 0, true),
      makeResult('rc03', 1, false), // 오답
      makeResult('rc04', 1, false), // 오답
      // embedded-clause: 1정답, 1오답
      makeResult('ec01', 0, true),
      makeResult('ec02', 1, false), // 오답
    ];

    const score = calculateScore(items, results);

    // 총점: 6 / 10 = 60
    expect(score.totalScore).toBe(60);
    expect(score.correctCount).toBe(6);

    // active-passive: 3/4 = 0.75
    expect(score.byType['active-passive'].correct).toBe(3);
    expect(score.byType['active-passive'].total).toBe(4);
    expect(score.byType['active-passive'].rate).toBe(0.75);

    // relative-clause: 2/4 = 0.5
    expect(score.byType['relative-clause'].correct).toBe(2);
    expect(score.byType['relative-clause'].total).toBe(4);
    expect(score.byType['relative-clause'].rate).toBe(0.5);

    // embedded-clause: 1/2 = 0.5
    expect(score.byType['embedded-clause'].correct).toBe(1);
    expect(score.byType['embedded-clause'].total).toBe(2);
    expect(score.byType['embedded-clause'].rate).toBe(0.5);
  });

  it('TC-07: embedded-clause 문항 없음 → byType[embedded-clause].rate = null', () => {
    const items: SentenceComprehensionItem[] = [
      makeItem('ap01', 'active-passive', 0, 0),
      makeItem('rc01', 'relative-clause', 0, 1),
    ];

    const results: SentenceComprehensionResult[] = [
      makeResult('ap01', 0, true),
      makeResult('rc01', 0, true),
    ];

    const score = calculateScore(items, results);

    expect(score.byType['embedded-clause'].total).toBe(0);
    expect(score.byType['embedded-clause'].rate).toBeNull();
  });

  it('결과가 없으면 averageReactionTimeMs = 0, averageReplayCount = 0', () => {
    const items: SentenceComprehensionItem[] = [
      makeItem('ap01', 'active-passive', 0, 0),
    ];

    const score = calculateScore(items, []);

    expect(score.averageReactionTimeMs).toBe(0);
    expect(score.averageReplayCount).toBe(0);
    expect(score.correctCount).toBe(0);
    expect(score.totalScore).toBe(0);
  });

  it('평균 반응시간과 재청취 횟수를 올바르게 계산한다', () => {
    const items: SentenceComprehensionItem[] = [
      makeItem('i01', 'active-passive', 0, 0),
      makeItem('i02', 'active-passive', 0, 1),
    ];

    const results: SentenceComprehensionResult[] = [
      makeResult('i01', 0, true, 1000, 2),
      makeResult('i02', 0, true, 2000, 0),
    ];

    const score = calculateScore(items, results);

    expect(score.averageReactionTimeMs).toBe(1500); // (1000 + 2000) / 2
    expect(score.averageReplayCount).toBe(1); // (2 + 0) / 2
  });

  it('totalItems=0이면 totalScore=0을 반환한다', () => {
    const score = calculateScore([], []);
    expect(score.totalScore).toBe(0);
    expect(score.totalItems).toBe(0);
  });
});
