import { QuizGenerationStatus } from '../constants/quiz-generation-status';

/**
 * GET /quiz/sets 목록 항목 DTO
 * - 보호자 입력 원문은 노출하지 않는다(환자에게는 날짜 기반 제목만 표시).
 * - bestScore: 최고 점수 (없으면 null)
 * - generationError: 생성 실패(failed) 시 사용자친화 사유 메시지 (그 외 null).
 *   보호자 폴링(S1)이 실패 원인을 표시하는 데 사용한다.
 */
export interface QuizSetSummaryDto {
  quizSetId: string;
  memoryEntryId: string;
  photoUrl: string | null;
  generationStatus: QuizGenerationStatus;
  generationError: string | null;
  bestScore: number | null;
  createdAt: string;
}
