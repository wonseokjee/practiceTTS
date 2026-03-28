/**
 * 문장 이해 (SentComp) 검사 - 도메인 타입 정의
 *
 * 불변 조건:
 * - SentenceComprehensionItem.choices 는 항상 정확히 2개 (tuple)
 * - choices 중 정확히 하나만 isCorrect=true 여야 한다
 * - SentenceComprehensionResult.selectedImageIndex 는 0 또는 1만 허용
 * - reactionTimeMs 는 0 이상 (음수 방지는 createReactionTime에서 처리)
 */

/** 문장 유형 */
export type SentenceType =
  | 'active-passive'
  | 'relative-clause'
  | 'embedded-clause';

/** 선택지 이미지 */
export interface ChoiceImage {
  readonly imageUrl: string;
  readonly altText: string;
  readonly isCorrect: boolean;
}

/** 문장 이해 검사 문항 */
export interface SentenceComprehensionItem {
  readonly itemId: string;
  readonly sentence: string;
  readonly sentenceAudioUrl: string;
  readonly sentenceType: SentenceType;
  /** 항상 2개 이미지 선택지 (tuple) */
  readonly choices: readonly [ChoiceImage, ChoiceImage];
  readonly orderIndex: number;
}

/** 문항별 응답 결과 */
export interface SentenceComprehensionResult {
  readonly itemId: string;
  readonly selectedImageIndex: 0 | 1;
  readonly isCorrect: boolean;
  readonly reactionTimeMs: number;
  readonly replayCount: number;
  readonly audioEndTimestamp: number;
  readonly selectionTimestamp: number;
}

/** 문장 유형별 통계 */
export interface SentenceTypeStats {
  readonly total: number;
  readonly correct: number;
  /** total === 0 이면 null (분모가 0인 경우 방지) */
  readonly rate: number | null;
}

/** 전체 채점 결과 */
export interface SentenceComprehensionScore {
  readonly totalItems: number;
  readonly correctCount: number;
  /** Math.round(correctCount / totalItems * 100) */
  readonly totalScore: number;
  readonly byType: Record<SentenceType, SentenceTypeStats>;
  /** 전체 결과의 reactionTimeMs 평균 (결과 없으면 0) */
  readonly averageReactionTimeMs: number;
  /** 전체 결과의 replayCount 평균 (결과 없으면 0) */
  readonly averageReplayCount: number;
}
