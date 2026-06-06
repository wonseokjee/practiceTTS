import { IsBoolean, IsOptional } from 'class-validator';

/**
 * POST /quiz/generate/:memoryEntryId 바디 DTO
 * - force=true: 기존 QuizSet이 있어도 재생성 (수동 트리거)
 */
export class GenerateQuizDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
