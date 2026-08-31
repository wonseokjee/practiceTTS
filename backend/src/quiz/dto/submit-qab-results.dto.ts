import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
} from 'class-validator';
import { QAB_SUBTESTS, type QabSubtest } from '../constants/qab-subtest';
import { QAB_FOIL_KINDS, type QabFoilKind } from '../constants/qab-foil-kind';

/**
 * `levels`의 키가 알려진 검사이고 값이 1~5 정수인지 본다.
 *
 * `Record`는 `@ValidateNested`가 못 다루고, 클래스로 만들면 검사 목록이 두 곳에
 * 생겨 검사를 추가할 때 한쪽만 고치게 된다. 상수 배열 하나만 보게 한다.
 */
function IsSkillLevelMap() {
  return function (target: object, propertyName: string): void {
    registerDecorator({
      name: 'isSkillLevelMap',
      target: target.constructor,
      propertyName,
      validator: {
        validate(value: unknown): boolean {
          if (value === null || typeof value !== 'object') return false;
          return Object.entries(value as Record<string, unknown>).every(
            ([key, level]) =>
              (QAB_SUBTESTS as readonly string[]).includes(key) &&
              typeof level === 'number' &&
              Number.isInteger(level) &&
              level >= 1 &&
              level <= 5,
          );
        },
        defaultMessage(): string {
          return 'levels는 알려진 검사명 → 1~5 정수여야 한다';
        },
      },
    });
  };
}

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

  // 채점 불가 — 음향 발음 평가를 얻지 못해 판정을 내리지 않은 문항.
  // true면 isCorrect는 무의미하며(false로 온다) 정확도 분모에서 빠진다.
  // "못 쟀다"를 "못했다"로 기록하지 않기 위한 플래그다.
  @IsOptional()
  @IsBoolean()
  unscored?: boolean;

  // 이름대기에서 몇 단계까지 단서를 받았나(E18). 없으면 단서 개념이 없는 검사다.
  //   0 무단서 · 1 의미 · (2 문장 완성 — 미구현) · 3 음소 · 4 통과
  // 2를 허용 범위에 남겨 둔 이유는 M25 주석 참고.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  cueLevel?: number;

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
  // **이 값이 저장된다.** 세션 내 적응(D7-C) 이후로는 프론트가 무엇을 냈는지
  // 아는 유일한 쪽이다 — 같은 세션 안에서 눈높이가 내려가면 서버가 가진 레벨과
  // 달라지고, 그때 서버값을 덮어쓰면 기록이 거짓이 된다.
  //
  // 다만 그대로 믿지는 않는다. 서버가 가진 레벨에서 **±1을 벗어나면** 클램프하고
  // 경고를 남긴다(quiz.service.ts). 적응 규칙이 세션당 한 칸이므로 정상 클라이언트는
  // 이 범위를 넘지 않는다.
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

  /**
   * 이 문항이 레벨이 요구한 밴드 밖에서 왔는가(M22).
   *
   * `foil_kind`와 같은 성격이다 — 서버가 되짚을 수 없는 관측값이라 그대로 저장하되
   * 채점·레벨 판정 어디에도 물리지 않는다. 조작해도 성적이 안 움직인다.
   */
  @IsOptional()
  @IsBoolean()
  bandFallback?: boolean;

  /** 이름대기에서 제시된 그림 종류(M22). 해당 없으면 생략. */
  @IsOptional()
  @IsIn(['photo', 'svg'])
  stimulusKind?: 'photo' | 'svg';
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

  /**
   * 세션이 끝날 때 각 검사의 눈높이 — 세션 내 적응(D7-C)의 결과다.
   *
   * 예전에는 서버가 최근 10시행 정확도로 레벨을 재계산했다. 실측 판정 지연이
   * 검사당 5~11세션이라, 학습되는 것이 능력이 아니라 최근 며칠의 컨디션이었다.
   * 이제 판정은 세션 안에서 문항 단위로 일어나고, 서버는 그 결과를 받는다.
   *
   * `completed=true`인 제출에서만 반영한다. 중간 flush로 레벨이 움직이면 한
   * 세션이 여러 번 레벨을 밀게 된다.
   *
   * 값은 그대로 믿지 않는다 — 저장된 레벨에서 ±1로 클램프한다.
   */
  @IsOptional()
  @IsObject()
  @IsSkillLevelMap()
  levels?: Partial<Record<QabSubtest, number>>;
}
