import { IsIn, IsOptional, ValidateIf } from 'class-validator';
import {
  PATIENT_NOTE_CATEGORIES,
  PatientNoteCategory,
} from '../../quiz/constants/patient-note-category';

/**
 * GET /diary-questions/today 쿼리 검증 DTO
 * - scope='patient'일 때 category는 필수
 * - scope='caregiver'일 때 category는 무시
 */
export class DiaryQuestionQueryDto {
  @IsIn(['caregiver', 'patient'], {
    message: 'scope는 caregiver 또는 patient 여야 합니다.',
  })
  scope: 'caregiver' | 'patient';

  // scope='patient'일 때만 검증 수행, 그 외에는 optional 통과
  @ValidateIf((o: DiaryQuestionQueryDto) => o.scope === 'patient')
  @IsOptional()
  @IsIn(PATIENT_NOTE_CATEGORIES, {
    message: `category는 ${PATIENT_NOTE_CATEGORIES.join(', ')} 중 하나여야 합니다.`,
  })
  category?: PatientNoteCategory;
}
