/**
 * 단어 이해 (WordComp) - 세션 요약 도메인 서비스 단위 테스트
 *
 * 테스트 대상: summarizeSession() 순수 함수
 * 의존성 없음 - Mock 불필요
 *
 * 검증 규칙:
 * - percentageScore = Math.round(totalScore / totalItems * 100)
 * - semanticErrorRate = semanticErrorCount / totalErrorCount (오답 0이면 0)
 * - averageReactionTimeMs = Math.round(합계 / 결과수) (결과 없으면 0)
 */

import { describe, it, expect } from 'vitest';
import { summarizeSession } from './WordComprehensionSummarizer.js';
import type { WordComprehensionSession } from '../entities/WordComprehensionSession.js';
import type { WordComprehensionItemResult } from '../entities/WordComprehensionItemResult.js';
import type { WordComprehensionScore } from '../valueObjects/WordComprehensionScore.js';
import type { ReactionTime } from '../valueObjects/ReactionTime.js';
import type { DistractorType } from '../valueObjects/DistractorType.js';

// 테스트용 헬퍼 함수

function makeScore(
  isCorrect: boolean,
  distractorType: DistractorType | undefined,
): WordComprehensionScore {
  return Object.freeze({
    rawScore: isCorrect ? 1 : 0,
    isCorrect,
    selectedDistractorType: distractorType,
  } as WordComprehensionScore);
}

function makeReactionTime(durationMs: number): ReactionTime {
  return Object.freeze({
    audioEndTimestamp: 1000,
    selectionTimestamp: 1000 + durationMs,
    durationMs,
  });
}

function makeItemResult(
  itemId: string,
  isCorrect: boolean,
  distractorType: DistractorType | undefined,
  durationMs: number,
  replayCount: number = 0,
): WordComprehensionItemResult {
  return {
    itemId,
    selectedChoiceId: `choice-${itemId}`,
    selectedWord: '테스트단어',
    score: makeScore(isCorrect, distractorType),
    reactionTime: makeReactionTime(durationMs),
    replayCount,
    completedAt: new Date('2026-02-27T09:00:00.000Z'),
  };
}

function makeSession(
  itemResults: ReadonlyArray<WordComprehensionItemResult>,
  totalItems: number = 20,
): WordComprehensionSession {
  return {
    sessionId: 'test-session-001',
    patientId: 'patient-001',
    startedAt: new Date('2026-02-27T09:00:00.000Z'),
    completedAt: new Date('2026-02-27T09:10:00.000Z'),
    itemResults,
    totalItems,
    status: 'completed',
  };
}

describe('WordComprehensionSummarizer.summarizeSession', () => {
  /**
   * TC-05: 20문항 중 정답 15개, 오답 5개(semantic 3, phonemic 1, unrelated 1)
   * 기댓값:
   * - totalScore=15
   * - percentageScore=75
   * - semanticErrorRate=0.6 (3/5)
   * - phonemicErrorRate=0.2 (1/5)
   * - unrelatedErrorRate=0.2 (1/5)
   */
  it('TC-05: 정답 15개, 오답 5개(semantic 3, phonemic 1, unrelated 1) 세션을 올바르게 집계한다', () => {
    const results: WordComprehensionItemResult[] = [
      // 정답 15개 (durationMs=1000ms씩)
      ...Array.from({ length: 15 }, (_, i) =>
        makeItemResult(`item-correct-${i + 1}`, true, undefined, 1000),
      ),
      // 의미 착어 오답 3개
      makeItemResult('item-sem-1', false, 'semantic', 1500),
      makeItemResult('item-sem-2', false, 'semantic', 1200),
      makeItemResult('item-sem-3', false, 'semantic', 1800),
      // 음운 착어 오답 1개
      makeItemResult('item-pho-1', false, 'phonemic', 2000),
      // 무관 오답 1개
      makeItemResult('item-unr-1', false, 'unrelated', 900),
    ];

    const session = makeSession(results);
    const summary = summarizeSession(session);

    expect(summary.totalScore).toBe(15);
    expect(summary.percentageScore).toBe(75);
    expect(summary.distractorPattern.semanticErrorCount).toBe(3);
    expect(summary.distractorPattern.phonemicErrorCount).toBe(1);
    expect(summary.distractorPattern.unrelatedErrorCount).toBe(1);
    expect(summary.distractorPattern.semanticErrorRate).toBeCloseTo(0.6, 5);
    expect(summary.distractorPattern.phonemicErrorRate).toBeCloseTo(0.2, 5);
    expect(summary.distractorPattern.unrelatedErrorRate).toBeCloseTo(0.2, 5);
  });

  /**
   * TC-06: 20문항 전부 정답
   * 기댓값:
   * - percentageScore=100
   * - 모든 errorCount=0, 모든 errorRate=0
   */
  it('TC-06: 전부 정답인 경우 percentageScore=100, 모든 errorCount와 errorRate가 0이다', () => {
    const results: WordComprehensionItemResult[] = Array.from(
      { length: 20 },
      (_, i) => makeItemResult(`item-${i + 1}`, true, undefined, 800),
    );

    const session = makeSession(results);
    const summary = summarizeSession(session);

    expect(summary.totalScore).toBe(20);
    expect(summary.percentageScore).toBe(100);
    expect(summary.distractorPattern.semanticErrorCount).toBe(0);
    expect(summary.distractorPattern.phonemicErrorCount).toBe(0);
    expect(summary.distractorPattern.unrelatedErrorCount).toBe(0);
    expect(summary.distractorPattern.semanticErrorRate).toBe(0);
    expect(summary.distractorPattern.phonemicErrorRate).toBe(0);
    expect(summary.distractorPattern.unrelatedErrorRate).toBe(0);
  });

  /**
   * TC-07: 20문항 전부 오답(semantic만)
   * 기댓값:
   * - percentageScore=0
   * - semanticErrorRate=1.0, phonemicErrorRate=0, unrelatedErrorRate=0
   */
  it('TC-07: 전부 오답(semantic만)인 경우 percentageScore=0, semanticErrorRate=1.0이다', () => {
    const results: WordComprehensionItemResult[] = Array.from(
      { length: 20 },
      (_, i) => makeItemResult(`item-${i + 1}`, false, 'semantic', 2500),
    );

    const session = makeSession(results);
    const summary = summarizeSession(session);

    expect(summary.totalScore).toBe(0);
    expect(summary.percentageScore).toBe(0);
    expect(summary.distractorPattern.semanticErrorCount).toBe(20);
    expect(summary.distractorPattern.semanticErrorRate).toBe(1.0);
    expect(summary.distractorPattern.phonemicErrorRate).toBe(0);
    expect(summary.distractorPattern.unrelatedErrorRate).toBe(0);
  });

  /**
   * TC-08: 빈 세션 (결과 없음)
   * 기댓값: totalScore=0, percentageScore=0, averageReactionTimeMs=0
   */
  it('TC-08: 결과가 없는 빈 세션은 totalScore=0, percentageScore=0, averageReactionTimeMs=0을 반환한다', () => {
    const session = makeSession([]);
    const summary = summarizeSession(session);

    expect(summary.totalScore).toBe(0);
    expect(summary.percentageScore).toBe(0);
    expect(summary.distractorPattern.semanticErrorCount).toBe(0);
    expect(summary.distractorPattern.phonemicErrorCount).toBe(0);
    expect(summary.distractorPattern.unrelatedErrorCount).toBe(0);
    expect(summary.averageReactionTimeMs).toBe(0);
    expect(summary.averageReplayCount).toBe(0);
  });
});
