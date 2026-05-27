import type { PatientNoteCategory } from '../../quiz/constants/patient-note-category';
import type { DiaryQuestion } from '../entities/diary-question.entity';

/**
 * 일기 질문 응답 DTO
 * - GET /diary-questions/today 응답에 사용
 */
export class DiaryQuestionResponseDto {
  id: string;
  scope: 'caregiver' | 'patient';
  category: PatientNoteCategory | null;
  text: string;
}

/**
 * DiaryQuestion 엔티티 → Response DTO 변환
 */
export function toDiaryQuestionResponseDto(
  entity: DiaryQuestion,
): DiaryQuestionResponseDto {
  return {
    id: entity.id,
    scope: entity.scope,
    category: entity.category,
    text: entity.text,
  };
}
