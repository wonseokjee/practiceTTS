import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import {
  PRACTICE_ITEM_KINDS,
  PRACTICE_TIERS,
  type PracticeItemKind,
  type PracticeTier,
} from '../constants/practice-item-kind';

/** 연습 문항 시도 1건 */
export class PracticeResultItemDto {
  @IsIn(PRACTICE_ITEM_KINDS)
  itemKind: PracticeItemKind;

  @IsString()
  @MaxLength(100)
  itemRef: string;

  /**
   * 같은 문항의 몇 번째 시도인가. 생략하면 1.
   * 단서를 받고 다시 시도하면 2를 보낸다 — 앞 시도를 덮어쓰지 않는다.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  attempt?: number;

  /**
   * 정오답. **생략이 정상이다.**
   * Tier 1(발화·채점 안 함)은 판정이 존재하지 않으므로 보내지 않는다.
   * 터치(Tier 0)와 채점 발화(Tier 2)만 보낸다.
   */
  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  /** 비용 계층 0/1/2. Azure 호출량 실측용이라 필수다. */
  @IsIn(PRACTICE_TIERS)
  tier: PracticeTier;
}

/**
 * POST /practice/results 바디 DTO
 *
 * 검사(POST /quiz/qab-results)와 **경로도 테이블도 다르다.** 연습 결과가 검사
 * 지표를 움직이지 못하게 하는 것이 이 모듈의 존재 이유다.
 *
 * 완료 마커(qab의 `completed`)에 대응하는 필드는 없다. 연습은 중간에 끊는 것이
 * 정상 사용이라, 완료/이탈을 구분하면 "포기율"이라는 없는 개념이 생긴다.
 */
export class SubmitPracticeResultsDto {
  @IsUUID('4')
  sessionToken: string;

  /**
   * 아직 안 보낸 시도 tail. 검사와 마찬가지로 문항마다 점진 제출한다 —
   * 중도 이탈해도 그때까지가 남는다. 빈 배열은 무해한 no-op으로 허용한다.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PracticeResultItemDto)
  results: PracticeResultItemDto[];
}
