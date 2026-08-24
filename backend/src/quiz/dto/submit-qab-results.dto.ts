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
import { QAB_SUBTESTS, type QabSubtest } from '../constants/qab-subtest';
import { QAB_FOIL_KINDS, type QabFoilKind } from '../constants/qab-foil-kind';

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

  // 이 항목이 제시된 난이도 레벨(1~5). 참고용/관측용일 뿐 신뢰하지 않는다 —
  // 저장되는 실제 presented_level은 서버가 skill_levels 현재 레벨로 확정한다
  // (quiz.service.ts saveQabResults). 서버값과 다르면 경고 로그만 남긴다.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  presentedLevel?: number;

  // 틀렸을 때 고른 오답의 갈래(단어이해만). 맞혔거나 갈래를 모르면 생략한다.
  //
  // presented_level과 달리 **서버가 되짚을 수 없다** — 낱말 뱅크와 오답 선택
  // 로직이 프론트에 있다. 그래서 클라이언트 값을 그대로 저장하되, 채점·레벨링
  // 어디에도 물리지 않는다. 관측만 하는 값이라 조작해도 성적이 안 움직인다.
  @IsOptional()
  @IsIn(QAB_FOIL_KINDS)
  foilKind?: QabFoilKind;
}

/**
 * POST /quiz/qab-results 바디 DTO
 * - 한 세션의 QAB 항목 결과를 제출. ADP-001로 문항마다 점진 제출되며, results는
 *   아직 안 보낸 tail만 담는다(세션 끝 1회 일괄 제출이 아니다).
 * - sessionToken: 데일리와 동일 세션 식별자.
 */
export class SubmitQabResultsDto {
  @IsUUID('4')
  sessionToken: string;

  /**
   * 아직 안 보낸 결과 tail. **빈 배열이 허용된다.**
   *
   * 예전엔 `@ArrayMinSize(1)`이라 빈 제출이 400이었는데, 그게 완료 마커를
   * 유실시켰다. 프론트는 문항마다 점진 제출하므로 세션이 끝나는 시점엔 보낼
   * tail이 없는 경우가 생긴다(특히 피로 탈출). 그때 `completed=true`만 보내야
   * 하는데 배열이 비어 거절당했고, 설계상 정상 종료가 중도 이탈로 기록됐다.
   *
   * 빈 배열 + `completed=false`는 무의미하지만 무해한 no-op이다(프론트가 그런
   * 요청을 보내지 않는다). 여기서 막는 것보다 완료 마커를 살리는 쪽이 낫다.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QabResultItemDto)
  results: QabResultItemDto[];

  // 정적 문항 풀 매니페스트 버전. presented_level 해석의 감사 추적용.
  // 현재 버전과 다르면 백엔드는 기록만(경고 로그), 거부하지 않는다.
  @IsOptional()
  @IsInt()
  @Min(0)
  manifestVersion?: number;

  // 이 제출로 세션이 끝까지 진행됐는지(자연 종료 또는 피로 탈출 안전장치).
  // true인 제출에만 완료 마커(qab_session_completions)를 남긴다. 점진 제출의
  // 중간 flush나 화면 이탈 시 best-effort flush는 생략(=중도 이탈로 남는다) —
  // 완료 vs 중단 구분(보호자 대시보드 이탈/완료율 통계용).
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
