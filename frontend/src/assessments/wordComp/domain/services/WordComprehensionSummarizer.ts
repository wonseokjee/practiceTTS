/**
 * 단어 이해 (WordComp) 검사 - 세션 요약 도메인 서비스
 *
 * 외부 의존성이 없는 순수 함수로 구성된다.
 * 완료된 세션 전체의 통계를 집계하여 요약 정보를 반환한다.
 *
 * 집계 규칙:
 * - percentageScore = Math.round(totalScore / totalItems * 100)
 * - errorRate = 각 유형 오답 수 / 전체 오답 수 (전체 오답 0이면 0)
 * - averageReactionTimeMs: 소수점 반올림
 * - averageReplayCount: 소수점 2자리
 */

import type { WordComprehensionSession } from '../entities/WordComprehensionSession.js';

export interface WordComprehensionSummary {
  readonly totalScore: number;
  readonly percentageScore: number;
  readonly distractorPattern: {
    readonly semanticErrorCount: number;
    readonly phonemicErrorCount: number;
    readonly unrelatedErrorCount: number;
    readonly semanticErrorRate: number;
    readonly phonemicErrorRate: number;
    readonly unrelatedErrorRate: number;
  };
  readonly averageReactionTimeMs: number;
  readonly averageReplayCount: number;
}

export function summarizeSession(
  session: WordComprehensionSession,
): WordComprehensionSummary {
  const results = session.itemResults;
  const totalItems = session.totalItems;

  const totalScore = results.reduce((sum, r) => sum + r.score.rawScore, 0);
  const percentageScore =
    totalItems > 0 ? Math.round((totalScore / totalItems) * 100) : 0;

  const errorResults = results.filter((r) => !r.score.isCorrect);
  const totalErrorCount = errorResults.length;

  const semanticErrorCount = errorResults.filter(
    (r) => r.score.selectedDistractorType === 'semantic',
  ).length;
  const phonemicErrorCount = errorResults.filter(
    (r) => r.score.selectedDistractorType === 'phonemic',
  ).length;
  const unrelatedErrorCount = errorResults.filter(
    (r) => r.score.selectedDistractorType === 'unrelated',
  ).length;

  const semanticErrorRate =
    totalErrorCount > 0 ? semanticErrorCount / totalErrorCount : 0;
  const phonemicErrorRate =
    totalErrorCount > 0 ? phonemicErrorCount / totalErrorCount : 0;
  const unrelatedErrorRate =
    totalErrorCount > 0 ? unrelatedErrorCount / totalErrorCount : 0;

  const averageReactionTimeMs =
    results.length > 0
      ? Math.round(
          results.reduce((sum, r) => sum + r.reactionTime.durationMs, 0) /
            results.length,
        )
      : 0;

  const averageReplayCount =
    results.length > 0
      ? Math.round(
          (results.reduce((sum, r) => sum + r.replayCount, 0) / results.length) * 100,
        ) / 100
      : 0;

  return Object.freeze({
    totalScore,
    percentageScore,
    distractorPattern: Object.freeze({
      semanticErrorCount,
      phonemicErrorCount,
      unrelatedErrorCount,
      semanticErrorRate,
      phonemicErrorRate,
      unrelatedErrorRate,
    }),
    averageReactionTimeMs,
    averageReplayCount,
  });
}
