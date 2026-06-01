import { IsString, Matches, MinLength } from 'class-validator';
import { IsEmail } from 'class-validator';

/**
 * 보호자 회원가입 DTO (보호자 단일 계정 모델)
 *
 * - role/patientId 입력 폐기 → 서버가 'caregiver' 강제 + 환자 레코드 동시 생성.
 * - patientDisplayName: 보호자가 돌보는 환자(어르신) 성함.
 * - patientModePin: 환자 모드 → 보호자 복귀 시 사용하는 4자리 숫자.
 */
export class RegisterDto {
  @IsEmail({}, { message: '유효한 이메일 주소를 입력해주세요.' })
  email: string;

  @IsString()
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  password: string;

  @IsString()
  @MinLength(1, { message: '표시 이름을 입력해주세요.' })
  displayName: string;

  @IsString()
  @MinLength(1, { message: '어르신 성함을 입력해주세요.' })
  patientDisplayName: string;

  @IsString()
  @Matches(/^[0-9]{4}$/, {
    message: '환자 모드 PIN은 4자리 숫자여야 합니다.',
  })
  patientModePin: string;
}
