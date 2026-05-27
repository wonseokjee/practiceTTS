import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { CaregiverReflectionInputDto } from './caregiver-reflection-input.dto';
import { MoodInputDto } from './mood-input.dto';
import { PatientMemoryNoteInputDto } from './patient-memory-note-input.dto';

// 감정 태그 허용 값 — @deprecated (P1-N9=(a) 호환 유지)
const VALID_EMOTION_TAGS = ['happy', 'calm', 'nostalgic', 'excited'] as const;

/**
 * multipart 바디 내 JSON 문자열을 객체로 파싱.
 * - string이면 JSON.parse 결과, 그 외에는 원본 그대로 반환.
 * - JSON.parse 실패 시 원본 문자열 유지 → 후속 @ValidateNested가 거부 (400).
 */
function parseJsonStringValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Transform 후 nested DTO instance까지 변환을 보장하는 헬퍼.
 *
 * 배경: class-transformer는 raw value가 string일 때 `@Type` 데코레이터를
 * 적용하지 않는다. 따라서 `@Transform` 단계에서 직접 plainToInstance를
 * 호출하여 nested instance를 만들어야 후속 `@ValidateNested`가 동작한다.
 */
function transformToInstance<T>(
  cls: new () => T,
): (params: { value: unknown }) => unknown {
  return ({ value }) => {
    const parsed = parseJsonStringValue(value);
    if (parsed === undefined || parsed === null) {
      return parsed;
    }
    if (typeof parsed !== 'object') {
      // 객체가 아니면 후속 검증이 거부하도록 원본 유지
      return parsed;
    }
    return plainToInstance(cls, parsed);
  };
}

function transformToInstanceArray<T>(
  cls: new () => T,
): (params: { value: unknown }) => unknown {
  return ({ value }) => {
    const parsed = parseJsonStringValue(value);
    if (!Array.isArray(parsed)) {
      return parsed;
    }
    return parsed.map((item: unknown) =>
      item && typeof item === 'object' ? plainToInstance(cls, item) : item,
    );
  };
}

/**
 * 라이프로그 생성 DTO (3-step 가이드 Q&A)
 *
 * 입력 시나리오:
 *  1. mood + patientAnswers(>=1)                    → 기본
 *  2. mood + caregiverAnswer + patientAnswers(>=1)  → 보호자 회고 포함
 *  3. mood + caregiverWishMessage + ...             → Phase 6 사전 (UI 비노출)
 *  4. mood + photo only (patientAnswers=[])         → 서비스 레이어에서 OR 검증 통과 (P1-N5=(b))
 *  5. mood + 둘 다 없음                              → 서비스 레이어에서 400
 *
 * P1-N5=(b): patientAnswers는 DTO에서 ArrayMinSize(0) 허용,
 * 서비스 레이어에서 `patientAnswers.length>=1 OR photo` 검증.
 *
 * P1-N9=(a): emotionTag / targetWords 는 deprecated optional 호환 유지.
 *
 * P1-N1=(a): multipart 바디의 JSON 문자열은 `@Transform` 단계에서
 *  plainToInstance를 직접 호출하여 nested instance까지 변환한다.
 */
export class CreateMemoryEntryDto {
  @IsUUID('4')
  patientId: string;

  // Step 1: 무드 (필수)
  @Transform(transformToInstance(MoodInputDto))
  @ValidateNested()
  @Type(() => MoodInputDto)
  mood: MoodInputDto;

  // Step 3: 환자분의 하루 (필수, 단 ArrayMinSize=0 — 서비스에서 photo와 OR 검증)
  @Transform(transformToInstanceArray(PatientMemoryNoteInputDto))
  @IsArray()
  @ArrayMinSize(0, {
    message: 'patientAnswers는 배열이어야 합니다.',
  })
  @ArrayMaxSize(5, {
    message: 'patientAnswers는 최대 5개까지 허용됩니다.',
  })
  @ValidateNested({ each: true })
  @Type(() => PatientMemoryNoteInputDto)
  patientAnswers: PatientMemoryNoteInputDto[];

  // Step 2: 나의 하루 (선택, 보호자 사적 답변)
  @IsOptional()
  @Transform(transformToInstance(CaregiverReflectionInputDto))
  @ValidateNested()
  @Type(() => CaregiverReflectionInputDto)
  caregiverAnswer?: CaregiverReflectionInputDto;

  // Phase 6 사전 — 보호자가 환자에게 전하는 한 마디 (선택, UI 비노출)
  @IsOptional()
  @IsString()
  @Length(1, 120, {
    message: 'caregiverWishMessage는 1~120자여야 합니다.',
  })
  caregiverWishMessage?: string;

  /**
   * @deprecated Phase 4 보호자 화면 재설계 이후 단계적으로 제거 예정.
   * Phase 1은 P1-N9=(a) 호환 유지 정책에 따라 optional로 받는다.
   */
  @IsOptional()
  @IsString()
  @IsIn(VALID_EMOTION_TAGS, {
    message: `emotionTag는 ${VALID_EMOTION_TAGS.join(', ')} 중 하나여야 합니다.`,
  })
  emotionTag?: 'happy' | 'calm' | 'nostalgic' | 'excited';

  /**
   * @deprecated Phase 4 보호자 화면 재설계 이후 단계적으로 제거 예정.
   * multipart로 전달될 때는 JSON 문자열 → 배열로 파싱한다.
   */
  @IsOptional()
  @Transform(({ value }) => parseJsonStringValue(value))
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3, { message: '목표 단어는 최대 3개까지 등록할 수 있습니다.' })
  targetWords?: string[];
}
