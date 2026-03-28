/**
 * 단어 이해 (WordComp) 검사 - 답변 제출 DTO
 *
 * 피드백 없음 정책: nextItem이 null이면 검사 완료.
 */

import type { WordComprehensionItemDTO } from './WordComprehensionItemDTO.js';

export interface SubmitAnswerRequestDTO {
  readonly sessionId: string;
  readonly itemId: string;
  readonly choiceId: string;
  readonly audioEndTimestamp: number;
  readonly selectionTimestamp: number;
  readonly replayCount: number;
}

export interface SubmitAnswerResponseDTO {
  readonly isCorrect: boolean;
  readonly sessionStatus: 'in-progress' | 'completed';
  readonly nextItem: WordComprehensionItemDTO | null;
  readonly currentScore: number;
  readonly itemIndex: number;
}
