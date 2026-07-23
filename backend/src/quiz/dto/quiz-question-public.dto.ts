import { QuizQuestionType } from '../constants/quiz-question-type';
import { QuizQuestion } from '../entities/quiz-question.entity';

/**
 * 환자 풀이용 문제 응답 DTO (정답 은닉).
 * - correctAnswer / explanation은 절대 포함하지 않는다.
 * - 예외: speech(따라읽기)는 단어를 "보고/듣고 따라 말하는" 과제라 정답이 비밀이 아니다.
 *   이때만 읽을 단어를 targetWord로 노출한다(그 외 유형은 항상 null).
 */
export interface QuizQuestionPublicDto {
  id: string;
  orderIndex: number;
  type: QuizQuestionType;
  prompt: string;
  choices: string[] | null;
  hintFirstChar: string | null;
  /** speech 따라읽기에서 화면에 표시·발음할 단어 (speech일 때만 non-null) */
  targetWord: string | null;
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
    // 따라읽기 단어는 노출하되, 그 외 유형의 정답은 절대 노출하지 않는다.
    targetWord: question.type === 'speech' ? question.correctAnswer : null,
  };
}
