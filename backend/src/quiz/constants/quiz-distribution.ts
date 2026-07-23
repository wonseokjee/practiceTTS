import { GeneratableQuizType } from './quiz-question-type';

/**
 * LLM에 요청하는 기본 문제 유형 분포 (생성 가능 유형 기준).
 * - 4지선다 3 + 예/아니오 0 + 빈칸 2 = 총 5문제
 * - 예/아니오(yes_no)는 50% 찍기·"무조건 예" 문제로 제외한다(생성하지 않음).
 *   (타입/채점은 옛 세트 호환을 위해 코드에 남겨두되, 새 세트엔 포함하지 않는다.)
 * - 빈칸(fill_blank) 2개는 백엔드가 받아서 **타일 조합 1 + 말하기 1**로 변환한다
 *   (최종 세트 구성: 객관식3 + 타일1 + 말하기1).
 * - FastAPI `/quiz/generate`의 distribution 기본 요청값으로 사용된다.
 */
export const DEFAULT_QUIZ_DISTRIBUTION: {
  [K in GeneratableQuizType]: number;
} = {
  multiple_choice: 3,
  yes_no: 0,
  fill_blank: 2,
} as const;
