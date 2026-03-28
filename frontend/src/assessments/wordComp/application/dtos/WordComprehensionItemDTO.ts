/**
 * 단어 이해 (WordComp) 검사 - 문항 DTO
 *
 * Domain의 WordComprehensionItem에서 선택지의 정답 정보를 은닉하여
 * Presentation 레이어에 전달한다.
 */

import type { WordComprehensionChoiceDTO } from './WordComprehensionChoiceDTO.js';

export interface WordComprehensionItemDTO {
  readonly itemId: string;
  readonly targetWord: string;
  readonly targetAudioUrl: string;
  readonly choices: ReadonlyArray<WordComprehensionChoiceDTO>;
}
