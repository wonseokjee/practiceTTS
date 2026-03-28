import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

// 감정 태그 허용 값
const VALID_EMOTION_TAGS = ['happy', 'calm', 'nostalgic', 'excited'] as const;

/**
 * 메모리 엔트리 수정 DTO
 * - 사진 수정 불가 (photoUrl 필드 제외)
 * - patientId 수정 불가 (생성 시 확정)
 * - emotionTag, targetWords만 수정 가능
 */
export class UpdateMemoryEntryDto {
  @IsOptional()
  @IsString()
  @IsIn(VALID_EMOTION_TAGS, {
    message: `emotionTag는 ${VALID_EMOTION_TAGS.join(', ')} 중 하나여야 합니다.`,
  })
  emotionTag?: 'happy' | 'calm' | 'nostalgic' | 'excited';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3, { message: '목표 단어는 최대 3개까지 등록할 수 있습니다.' })
  targetWords?: string[];
}
