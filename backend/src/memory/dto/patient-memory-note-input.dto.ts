import { IsIn, IsString, IsUUID, Length } from 'class-validator';
import {
  PATIENT_NOTE_CATEGORIES,
  PatientNoteCategory,
} from '../../quiz/constants/patient-note-category';

/**
 * 환자 답변(PatientMemoryNote) 입력 DTO (Step 3 nested)
 * - questionId는 사전 시드된 DiaryQuestion(scope='patient')의 UUID
 * - category: activity / moment / context
 * - answerText: 1~300자
 */
export class PatientMemoryNoteInputDto {
  @IsUUID('4', {
    message: 'patientAnswers.questionId는 UUID 형식이어야 합니다.',
  })
  questionId: string;

  @IsIn(PATIENT_NOTE_CATEGORIES, {
    message: `patientAnswers.category는 ${PATIENT_NOTE_CATEGORIES.join(
      ', ',
    )} 중 하나여야 합니다.`,
  })
  category: PatientNoteCategory;

  @IsString()
  @Length(1, 300, {
    message: 'patientAnswers.answerText는 1~300자여야 합니다.',
  })
  answerText: string;
}
