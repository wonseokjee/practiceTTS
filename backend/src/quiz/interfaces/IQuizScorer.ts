import { QuizQuestion } from '../entities/quiz-question.entity';

/**
 * 채점 규칙 캡슐화 (R3 점수 산정 / R4 빈칸 채점 엄격도).
 * - 문제 유형별 정오답 판정과 점수 환산을 한 곳에 격리한다.
 */
export interface IQuizScorer {
  /** 단일 문제 정오답 판정 */
  isCorrect(question: QuizQuestion, userAnswer: string): boolean;

  /** 정답 개수 → 0..100 점수 환산 (R3=(b)) */
  toScore(correctCount: number, totalQuestions: number): number;
}

/** DI 토큰 */
export const QUIZ_SCORER = Symbol('QUIZ_SCORER');
