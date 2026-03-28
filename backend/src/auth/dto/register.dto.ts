import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class RegisterDto {
  @IsEmail({}, { message: '유효한 이메일 주소를 입력해주세요.' })
  email: string;

  @IsString()
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  password: string;

  @IsIn(['caregiver', 'patient', 'therapist'], {
    message: '역할은 caregiver, patient, therapist 중 하나여야 합니다.',
  })
  role: UserRole;

  @IsString()
  @MinLength(1, { message: '표시 이름을 입력해주세요.' })
  displayName: string;

  // 보호자가 환자를 연결할 때 사용하는 선택 필드
  @IsOptional()
  @IsUUID('4', { message: '유효한 환자 ID 형식이 아닙니다.' })
  patientId?: string;
}
