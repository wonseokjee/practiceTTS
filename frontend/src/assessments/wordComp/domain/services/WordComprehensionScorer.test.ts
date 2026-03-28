/**
 * 단어 이해 (WordComp) - 채점 도메인 서비스 단위 테스트
 *
 * 테스트 대상: scoreItem() 순수 함수
 * 의존성 없음 - Mock 불필요
 */

import { describe, it, expect } from 'vitest';
import { scoreItem } from './WordComprehensionScorer.js';
import type { WordComprehensionChoice } from '../entities/WordComprehensionItem.js';

// 테스트용 선택지 팩토리 헬퍼
function makeChoice(
  overrides: Partial<WordComprehensionChoice>,
): WordComprehensionChoice {
  return {
    choiceId: 'choice-001',
    word: '사과',
    imageUrl: '/images/apple.png',
    isCorrect: false,
    distractorType: 'semantic',
    ...overrides,
  };
}

describe('WordComprehensionScorer.scoreItem', () => {
  /**
   * TC-01: 정답 선택지(isCorrect: true)를 선택한 경우
   * 기댓값: isCorrect=true, rawScore=1, selectedDistractorType=undefined
   */
  it('TC-01: 정답 선택지 선택 시 isCorrect=true, rawScore=1, selectedDistractorType=undefined를 반환한다', () => {
    const correctChoice = makeChoice({
      isCorrect: true,
      distractorType: undefined,
    });

    const result = scoreItem(correctChoice);

    expect(result.isCorrect).toBe(true);
    expect(result.rawScore).toBe(1);
    expect(result.selectedDistractorType).toBeUndefined();
  });

  /**
   * TC-02: 의미 착어 오답(distractorType: 'semantic')을 선택한 경우
   * 기댓값: isCorrect=false, rawScore=0, selectedDistractorType='semantic'
   */
  it("TC-02: 의미 착어 오답 선택 시 isCorrect=false, rawScore=0, selectedDistractorType='semantic'을 반환한다", () => {
    const semanticChoice = makeChoice({
      isCorrect: false,
      distractorType: 'semantic',
    });

    const result = scoreItem(semanticChoice);

    expect(result.isCorrect).toBe(false);
    expect(result.rawScore).toBe(0);
    expect(result.selectedDistractorType).toBe('semantic');
  });

  /**
   * TC-03: 음운 착어 오답(distractorType: 'phonemic')을 선택한 경우
   * 기댓값: isCorrect=false, rawScore=0, selectedDistractorType='phonemic'
   */
  it("TC-03: 음운 착어 오답 선택 시 isCorrect=false, rawScore=0, selectedDistractorType='phonemic'을 반환한다", () => {
    const phonemicChoice = makeChoice({
      isCorrect: false,
      distractorType: 'phonemic',
    });

    const result = scoreItem(phonemicChoice);

    expect(result.isCorrect).toBe(false);
    expect(result.rawScore).toBe(0);
    expect(result.selectedDistractorType).toBe('phonemic');
  });

  /**
   * TC-04: 무관 오답(distractorType: 'unrelated')을 선택한 경우
   * 기댓값: isCorrect=false, rawScore=0, selectedDistractorType='unrelated'
   */
  it("TC-04: 무관 오답 선택 시 isCorrect=false, rawScore=0, selectedDistractorType='unrelated'을 반환한다", () => {
    const unrelatedChoice = makeChoice({
      isCorrect: false,
      distractorType: 'unrelated',
    });

    const result = scoreItem(unrelatedChoice);

    expect(result.isCorrect).toBe(false);
    expect(result.rawScore).toBe(0);
    expect(result.selectedDistractorType).toBe('unrelated');
  });
});
