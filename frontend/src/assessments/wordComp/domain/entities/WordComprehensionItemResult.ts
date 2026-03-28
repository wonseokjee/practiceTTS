/**
 * 단어 이해 (WordComp) 검사 - 문항별 응답 결과 엔티티
 *
 * 단일 문항에 대한 사용자 응답 결과를 불변 레코드로 나타낸다.
 */

import type { WordComprehensionScore } from '../valueObjects/WordComprehensionScore.js';
import type { ReactionTime } from '../valueObjects/ReactionTime.js';

export interface WordComprehensionItemResult {
  readonly itemId: string;
  readonly selectedChoiceId: string;
  readonly selectedWord: string;
  readonly score: WordComprehensionScore;
  readonly reactionTime: ReactionTime;
  readonly replayCount: number;
  readonly completedAt: Date;
}
