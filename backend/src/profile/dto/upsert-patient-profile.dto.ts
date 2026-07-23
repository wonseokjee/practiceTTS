import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import {
  MAX_FAMILY_MEMBERS,
  MAX_HOBBIES,
  MAX_NOTES_LENGTH,
  MAX_SIGNIFICANT_PLACES,
  MAX_TEXT_FIELD_LENGTH,
} from '../constants/profile.constants';
import { FamilyMemberInputDto } from './family-member-input.dto';

/**
 * 환자 프로필 upsert DTO.
 * - family를 함께 전달하면 가족 목록을 전체 교체(replace)한다.
 * - family 미전달 시 프로필 본문만 갱신하고 가족은 유지한다.
 */
export class UpsertPatientProfileDto {
  @IsOptional()
  @IsString()
  @Length(0, MAX_TEXT_FIELD_LENGTH)
  hometown?: string;

  @IsOptional()
  @IsString()
  @Length(0, MAX_TEXT_FIELD_LENGTH)
  occupation?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_HOBBIES, {
    message: `취미는 최대 ${MAX_HOBBIES}개까지 등록할 수 있습니다.`,
  })
  hobbies?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_SIGNIFICANT_PLACES, {
    message: `의미 있는 장소는 최대 ${MAX_SIGNIFICANT_PLACES}개까지 등록할 수 있습니다.`,
  })
  significantPlaces?: string[];

  @IsOptional()
  @IsString()
  @Length(0, MAX_NOTES_LENGTH)
  notes?: string;

  // 상한을 넘기면 400으로 거절한다. 검증이 없으면 서비스의 slice(0, MAX)가
  // 초과분을 조용히 버리고 200을 돌려줘, 보호자는 저장된 줄 알고 넘어간다.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FAMILY_MEMBERS, {
    message: `가족은 최대 ${MAX_FAMILY_MEMBERS}명까지 등록할 수 있습니다.`,
  })
  @ValidateNested({ each: true })
  @Type(() => FamilyMemberInputDto)
  family?: FamilyMemberInputDto[];
}
