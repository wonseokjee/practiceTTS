/**
 * 단어 이해 (WordComp) 검사 - 선택지 DTO
 *
 * Domain의 WordComprehensionChoice에서 정답 정보(isCorrect, distractorType)를
 * 제거하여 Presentation 레이어에 정답을 은닉한다.
 */

export interface WordComprehensionChoiceDTO {
  readonly choiceId: string;
  readonly word: string;
  readonly imageUrl: string;
}
