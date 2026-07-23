import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** 단일 문제 답안 */
export class AttemptAnswerDto {
  @IsUUID('4')
  questionId: string;

  // 빈 문자열 답안 허용 (무응답 제출 케이스) — @IsString + 길이 제한만 적용
  @IsString()
  @MaxLength(200)
  userAnswer: string;
}

/**
 * POST /quiz/sets/:id/attempts 바디 DTO
 * - sessionToken: 클라이언트가 풀이 시작 시 생성한 5문제 묶음 식별자
 * - answers: 1개 이상 답안 (개별/일괄 제출 모두 허용)
 */
export class SubmitAttemptDto {
  @IsUUID('4')
  sessionToken: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttemptAnswerDto)
  answers: AttemptAnswerDto[];
}
