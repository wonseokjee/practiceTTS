import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

// 감정 태그 허용 값
const VALID_EMOTION_TAGS = ['happy', 'calm', 'nostalgic', 'excited'] as const;

export class CreateMemoryEntryDto {
  // 훈련 대상 환자 ID (보호자가 지정)
  @IsUUID()
  patientId: string;

  // 감정 태그 (선택)
  @IsOptional()
  @IsString()
  @IsIn(VALID_EMOTION_TAGS, {
    message: `emotionTag는 ${VALID_EMOTION_TAGS.join(', ')} 중 하나여야 합니다.`,
  })
  emotionTag?: 'happy' | 'calm' | 'nostalgic' | 'excited';

  // 목표 단어 목록 (최대 3개, 선택)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3, { message: '목표 단어는 최대 3개까지 등록할 수 있습니다.' })
  targetWords?: string[];
}
