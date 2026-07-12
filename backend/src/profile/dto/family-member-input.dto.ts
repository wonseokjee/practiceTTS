import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import {
  VALID_FAMILY_RELATIONS,
  type FamilyRelation,
  MAX_TEXT_FIELD_LENGTH,
} from '../constants/profile.constants';

/**
 * 가족 구성원 추가/수정 입력 DTO.
 */
export class FamilyMemberInputDto {
  @IsString()
  @IsIn(VALID_FAMILY_RELATIONS, {
    message: `relation은 ${VALID_FAMILY_RELATIONS.join(', ')} 중 하나여야 합니다.`,
  })
  relation: FamilyRelation;

  @IsString()
  @Length(1, MAX_TEXT_FIELD_LENGTH, {
    message: `이름은 1~${MAX_TEXT_FIELD_LENGTH}자여야 합니다.`,
  })
  name: string;

  @IsOptional()
  @IsString()
  @IsIn(['M', 'F', 'U'], { message: 'gender는 M, F, U 중 하나여야 합니다.' })
  gender?: 'M' | 'F' | 'U';

  @IsOptional()
  @IsString()
  @Length(0, MAX_TEXT_FIELD_LENGTH)
  note?: string;
}
