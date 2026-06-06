import { QuizQuestionType } from '../constants/quiz-question-type';
import { QuizQuestion } from '../entities/quiz-question.entity';

/**
 * 환자 풀이용 문제 응답 DTO (정답 은닉).
 * - correctAnswer / explanation은 절대 포함하지 않는다.
 */
export interface QuizQuestionPublicDto {
  id: string;
  orderIndex: number;
  type: QuizQuestionType;
  prompt: string;
  choices: string[] | null;
  hintFirstChar: string | null;
}

/** QuizQuestion 엔티티 → 정답 은닉 Public DTO 매퍼 */
export function toQuizQuestionPublicDto(
  question: QuizQuestion,
): QuizQuestionPublicDto {
  return {
    id: question.id,
    orderIndex: question.orderIndex,
    type: question.type,
    prompt: question.prompt,
    choices: question.choices ?? null,
    hintFirstChar: question.hintFirstChar ?? null,
  };
}
