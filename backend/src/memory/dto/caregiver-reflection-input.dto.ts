import { IsString, IsUUID, Length } from 'class-validator';

/**
 * 보호자 "나의 하루" 사적 답변 입력 DTO (Step 2 nested, 선택)
 * - questionId는 사전 시드된 DiaryQuestion(scope='caregiver')의 UUID
 * - answerText: 1~300자
 * - 서비스 레이어에서 isPrivate=true 강제
 */
export class CaregiverReflectionInputDto {
  @IsUUID('4', {
    message: 'caregiverAnswer.questionId는 UUID 형식이어야 합니다.',
  })
  questionId: string;

  @IsString()
  @Length(1, 300, {
    message: 'caregiverAnswer.answerText는 1~300자여야 합니다.',
  })
  answerText: string;
}
