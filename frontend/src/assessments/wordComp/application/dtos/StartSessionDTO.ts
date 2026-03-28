/**
 * 단어 이해 (WordComp) 검사 - 세션 시작 DTO
 */

import type { WordComprehensionItemDTO } from './WordComprehensionItemDTO.js';

export interface StartSessionRequestDTO {
  readonly patientId: string;
}

export interface StartSessionResponseDTO {
  readonly sessionId: string;
  readonly firstItem: WordComprehensionItemDTO;
  readonly totalItems: number;
}
