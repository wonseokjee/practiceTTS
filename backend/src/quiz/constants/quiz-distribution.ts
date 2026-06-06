import { QuizQuestionType } from './quiz-question-type';

/**
 * 기본 문제 유형 분포 (§2-5, R6=(b) 기본값)
 * - 4지선다 2 + 예/아니오 2 + 빈칸 1 = 총 5문제
 * - FastAPI `/quiz/generate`의 distribution 기본 요청값으로 사용된다.
 */
export const DEFAULT_QUIZ_DISTRIBUTION: { [K in QuizQuestionType]: number } = {
  multiple_choice: 2,
  yes_no: 2,
  fill_blank: 1,
} as const;
