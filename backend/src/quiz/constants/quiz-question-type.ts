/**
 * 퀴즈 문제 유형
 * - multiple_choice: 4지선다 (choices에 string[] 저장)
 * - yes_no: 예/아니오
 * - fill_blank: 빈칸 채우기 (hintFirstChar 사용 가능)
 */
export const QUIZ_QUESTION_TYPES = [
  'multiple_choice',
  'yes_no',
  'fill_blank',
] as const;

export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];
