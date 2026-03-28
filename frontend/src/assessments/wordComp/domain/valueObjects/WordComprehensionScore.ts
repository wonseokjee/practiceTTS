/**
 * 단어 이해 (WordComp) 검사 - 채점 결과 값 객체
 *
 * 단일 문항에 대한 정오 판정 결과를 나타낸다.
 *
 * 불변 조건:
 * - isCorrect === true 이면 selectedDistractorType은 반드시 undefined
 * - isCorrect === false 이면 rawScore는 반드시 0
 * - isCorrect === false 이면 selectedDistractorType이 있어야 함
 */

import type { DistractorType } from './DistractorType.js';
import {
  WordComprehensionDomainError,
  WcDomainErrorCode,
} from '../errors/WordComprehensionDomainError.js';

export interface WordComprehensionScore {
  readonly rawScore: 0 | 1;
  readonly isCorrect: boolean;
  readonly selectedDistractorType: DistractorType | undefined;
}

/**
 * WordComprehensionScore 팩토리 함수.
 * 불변 조건을 검증하고 동결된 값 객체를 반환한다.
 *
 * @param isCorrect - 정답 여부
 * @param distractorType - 오답 선택지 유형 (정답 선택 시 undefined)
 */
export function createScore(
  isCorrect: boolean,
  distractorType: DistractorType | undefined,
): WordComprehensionScore {
  if (isCorrect && distractorType !== undefined) {
    throw new WordComprehensionDomainError(
      WcDomainErrorCode.INVALID_SCORE,
      '정답을 선택한 경우 selectedDistractorType은 undefined여야 합니다.',
    );
  }

  if (!isCorrect && distractorType === undefined) {
    throw new WordComprehensionDomainError(
      WcDomainErrorCode.INVALID_SCORE,
      '오답을 선택한 경우 selectedDistractorType이 있어야 합니다.',
    );
  }

  const rawScore: 0 | 1 = isCorrect ? 1 : 0;

  return Object.freeze({
    rawScore,
    isCorrect,
    selectedDistractorType: distractorType,
  });
}
