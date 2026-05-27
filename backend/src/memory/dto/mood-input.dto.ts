import { IsInt, Max, Min } from 'class-validator';

/**
 * 보호자 무드 입력 DTO (Step 1)
 * - level: 1(매우 나쁨) ~ 5(매우 좋음)
 */
export class MoodInputDto {
  @IsInt({ message: 'mood.level은 정수여야 합니다.' })
  @Min(1, { message: 'mood.level은 1 이상이어야 합니다.' })
  @Max(5, { message: 'mood.level은 5 이하여야 합니다.' })
  level: 1 | 2 | 3 | 4 | 5;
}
