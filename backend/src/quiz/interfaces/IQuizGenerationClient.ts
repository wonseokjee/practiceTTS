import { QuizQuestionType } from '../constants/quiz-question-type';
import { IQuizGenerationPayload } from './IQuizGenerationPayload';

/**
 * FastAPI `/quiz/generate` 응답을 도메인 형태로 정규화한 단일 문제.
 * - snake_case → camelCase 매핑은 클라이언트 어댑터에서 수행한다.
 */
export interface GeneratedQuizQuestion {
  type: QuizQuestionType;
  prompt: string;
  choices: string[] | null;
  correctAnswer: string;
  hintFirstChar: string | null;
}

/** LLM 생성 결과 (문제 목록 + 메타데이터) */
export interface QuizGenerationResult {
  questions: GeneratedQuizQuestion[];
  model: string;
  fallbackUsed: boolean;
}

/**
 * 퀴즈 생성 클라이언트 추상화 (FastAPI 호출 경계).
 * - 입력은 화이트리스트 페이로드(IQuizGenerationPayload)만 허용한다.
 */
export interface IQuizGenerationClient {
  generate(payload: IQuizGenerationPayload): Promise<QuizGenerationResult>;
}

/** DI 토큰 */
export const QUIZ_GENERATION_CLIENT = Symbol('QUIZ_GENERATION_CLIENT');
