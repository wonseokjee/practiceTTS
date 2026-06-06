import { QuizGenerationStatus } from '../constants/quiz-generation-status';

/**
 * GET /quiz/sets 목록 항목 DTO
 * - notePreview: 해당 라이프로그의 환자 답변을 짧게 조합한 미리보기
 * - bestScore: 최고 점수 (없으면 null)
 */
export interface QuizSetSummaryDto {
  quizSetId: string;
  memoryEntryId: string;
  notePreview: string;
  photoUrl: string | null;
  generationStatus: QuizGenerationStatus;
  bestScore: number | null;
  createdAt: string;
}
