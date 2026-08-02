import { IsString, Matches, MinLength } from 'class-validator';

/**
 * 소셜 최초 로그인 후 온보딩 DTO.
 * 회원가입 때 받던 "어르신 성함 + 환자 모드 PIN"을 소셜은 안 주므로 여기서 받는다.
 * (RegisterDto의 해당 필드와 동일 규칙)
 */
export class CompleteOnboardingDto {
  @IsString()
  @MinLength(1, { message: '어르신 성함을 입력해주세요.' })
  patientDisplayName: string;

  @IsString()
  @Matches(/^[0-9]{4}$/, {
    message: '환자 모드 PIN은 4자리 숫자여야 합니다.',
  })
  patientModePin: string;
}
