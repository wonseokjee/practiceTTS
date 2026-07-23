/**
 * 퀴즈 문제 유형 (저장/채점/표시용 전체 집합)
 * - multiple_choice: 4지선다 (choices에 string[] 저장)
 * - yes_no: 예/아니오
 * - fill_blank: 빈칸 채우기 (hintFirstChar 사용 가능) — 현재 세트 기본 구성에선 미사용
 * - tile_arrange: 글자(음절) 타일 조합 (choices에 섞인 음절 타일 저장, 정답은 fill_blank처럼 채점)
 * - speech: 음성으로 말하기 (STT 인식 텍스트를 fill_blank처럼 채점)
 *
 * tile_arrange/speech는 정답이 모두 텍스트이므로 채점은 fill_blank 규칙을 재사용한다.
 */
export const QUIZ_QUESTION_TYPES = [
  'multiple_choice',
  'yes_no',
  'fill_blank',
  'tile_arrange',
  'speech',
] as const;

export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

/**
 * LLM(FastAPI `/quiz/generate`)이 직접 생성할 수 있는 유형의 부분집합.
 * - AI 서비스는 mc/yn/fill_blank만 알며, tile_arrange/speech는 백엔드가 fill_blank를
 *   변환해 만든다. 따라서 분배(distribution) 요청에는 이 부분집합만 사용한다.
 */
export const GENERATABLE_QUIZ_TYPES = [
  'multiple_choice',
  'yes_no',
  'fill_blank',
] as const;

export type GeneratableQuizType = (typeof GENERATABLE_QUIZ_TYPES)[number];
