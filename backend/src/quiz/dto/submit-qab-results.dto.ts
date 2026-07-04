import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { QAB_SUBTESTS, type QabSubtest } from '../constants/qab-subtest';

/** 단일 QAB 항목 결과 */
export class QabResultItemDto {
  @IsIn(QAB_SUBTESTS)
  subtest: QabSubtest;

  @IsString()
  @MaxLength(100)
  itemRef: string;

  @IsBoolean()
  isCorrect: boolean;

  // 보호자가 "넘어가기"로 통과시킨 문항이면 true(없으면 false). 정확도 집계에서 제외.
  @IsOptional()
  @IsBoolean()
  assisted?: boolean;

  // ddk 감지 횟수 등(없으면 생략). 비현실적 값 방지로 0..1000 범위.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  metric?: number;

  // 발음 정확도 점수(0~100). 발화 항목(따라말하기/읽기)만 전송, 그 외 생략.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

/**
 * POST /quiz/qab-results 바디 DTO
 * - 한 세션의 QAB 항목 결과를 일괄 제출(세션 완료 시 1회).
 * - sessionToken: 데일리와 동일 세션 식별자.
 */
export class SubmitQabResultsDto {
  @IsUUID('4')
  sessionToken: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QabResultItemDto)
  results: QabResultItemDto[];
}
