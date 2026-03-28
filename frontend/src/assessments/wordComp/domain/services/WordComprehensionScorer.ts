/**
 * 단어 이해 (WordComp) 검사 - 채점 도메인 서비스
 *
 * 외부 의존성이 없는 순수 함수로 구성된다.
 * 선택된 선택지 정보만으로 정오 판정을 수행한다.
 */

import type { WordComprehensionChoice } from '../entities/WordComprehensionItem.js';
import type { WordComprehensionScore } from '../valueObjects/WordComprehensionScore.js';
import { createScore } from '../valueObjects/WordComprehensionScore.js';

/**
 * 선택한 선택지를 기반으로 채점 결과를 반환한다.
 *
 * @param selectedChoice - 사용자가 선택한 선택지
 */
export function scoreItem(
  selectedChoice: WordComprehensionChoice,
): WordComprehensionScore {
  return createScore(selectedChoice.isCorrect, selectedChoice.distractorType);
}
