/**
 * 단어 이해 (WordComp) 검사 - 세션 요약 결과 DTO
 */

export interface SessionSummaryDTO {
  readonly totalScore: number;
  readonly percentageScore: number;
  readonly totalItems: number;
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
